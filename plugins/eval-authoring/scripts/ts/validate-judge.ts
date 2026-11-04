/**
 * Hand-run (#868): measure an `llm` grader's agreement with human labels, with no
 * live reply under test. Builds a throwaway probe plugin: one stub case per labelled
 * reply, whose scaffold writes the reply to `reply.txt` and whose `llm` grader judges
 * that file with the real grader's criteria. `node validate-judge.ts --help`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { headerReplies } from "./check-replies.ts";
import { readSuite, type LlmGrader } from "./parser/index.ts";
import { isRec } from "./run-evals/summary.ts";

const USAGE = `Usage: validate-judge.ts [-h|--help] --plugin ROOT --case NAME --grader NAME
                         [--labels FILE] [--split dev|test] [--judge-model M] --out DIR

Writes a probe plugin to DIR (free: no model call) and prints the two commands that
measure the judge: a paid \`claude plugin eval\` run of the probe (one stub agent turn and
three judge votes per label, about $0.001 per label at haiku) and the free
\`judge-agreement.ts\` report on its result (agreement, kappa, TPR and TNR).

  --plugin ROOT   the plugin that owns the case
  --case NAME     the case directory name (dirName)
  --grader NAME   the case's \`llm\` grader to validate (its criteria are copied verbatim)
  --labels FILE   JSON array of human labels:
                  [{"label": "PASS", "reply": "the full reply text", "split": "dev"}]
                  label is PASS or FAIL; split ("dev" or "test") is optional. Without
                  this flag the case's own # good-reply: and # bad-reply: header lines
                  are used (one PASS, one FAIL).
  --split S       keep only labels with this split (tune the rubric on dev, report
                  the number on test, and do not edit the rubric after seeing test)
  --judge-model M put \`--judge-model M\` in the printed run command; use the judge
                  your real runs use, since scores compare only at one judge
  --out DIR       where to write the probe (created; files are overwritten)

The probe's judge reads the reply as the contents of a file (\`focus\` is a file), not as
Claude's final message, so it is a close stand-in for the real grader, not an identical
one. Needs at least one PASS and one FAIL label after --split.

Exit 0 written, 1 unusable input, 2 usage.
`;

export interface Label {
  readonly label: "PASS" | "FAIL";
  readonly reply: string;
  readonly split?: "dev" | "test";
}

export interface Loaded {
  readonly criteria: string;
  readonly good: string | undefined;
  readonly bad: string | undefined;
}

export interface Io {
  readonly readFile: (path: string) => string | undefined;
  readonly writeFile: (path: string, text: string) => void;
  /** The grader's criteria and the case's header replies, or an error message. */
  readonly load: (plugin: string, caseName: string, grader: string) => Loaded | string;
}

export interface Outcome {
  readonly code: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const asLabel = (l: unknown): Label | undefined => {
  if (!isRec(l)) return undefined;
  const { label, reply, split } = l;
  return (label === "PASS" || label === "FAIL") &&
    typeof reply === "string" &&
    reply !== "" &&
    (split === undefined || split === "dev" || split === "test")
    ? { label, reply, ...(split === undefined ? {} : { split }) }
    : undefined;
};

/** A label list from JSON text, or an error message. */
export const parseLabels = (text: string): readonly Label[] | string => {
  const parsed: unknown = (() => {
    try {
      const v: unknown = JSON.parse(text);
      return v;
    } catch {
      return undefined;
    }
  })();
  if (!Array.isArray(parsed)) return "labels must be a JSON array";
  const labels = parsed.map(asLabel);
  const bad = labels.findIndex((l) => l === undefined);
  return bad >= 0
    ? `label ${String(bad + 1)} needs "label" (PASS or FAIL), a non-empty "reply" string and an optional "split" of dev or test`
    : labels.flatMap((l) => (l === undefined ? [] : [l]));
};

const pad = (n: number): string => String(n).padStart(2, "0");
const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

/** The probe's files, keyed by path under the probe directory. Pure. */
export const probeFiles = (
  out: string,
  grader: string,
  criteria: string,
  labels: readonly Label[],
): ReadonlyMap<string, string> => {
  const indented = criteria
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l === "" ? "" : `      ${l}`))
    .join("\n");
  const cases = labels.flatMap((l, i) => {
    const dir = `evals/judge-${pad(i + 1)}`;
    const replyPath = resolve(out, dir, "reply.txt");
    return [
      [`${dir}/reply.txt`, l.reply],
      // The reply is copied from a data file, never spliced into the script, so its text cannot run as shell.
      [`${dir}/fixture.sh`, `#!/bin/bash\ncp ${shellQuote(replyPath)} reply.txt\n`],
      [
        `${dir}/case.yaml`,
        [
          'schema_version: "1.1"',
          `name: judge-${pad(i + 1)}`,
          "description: >",
          `  Probe stub (validate-judge). The scaffold writes a labelled ${l.label} reply to reply.txt and`,
          "  the llm grader judges that file. expected_outcome: the judge agrees with the label.",
          "tags: [probe]",
          "context:",
          "  scaffold_script: fixture.sh",
          "execution:",
          "  prompt: |",
          "    Reply with the single word: done.",
          "  max_turns: 1",
          "  allowed_tools: []",
          "graders:",
          `  - name: ${grader}`,
          "    type: llm",
          "    focus:",
          "      source: file",
          "      path: reply.txt",
          "    criteria: |",
          indented,
          "",
        ].join("\n"),
      ],
    ] as const;
  });
  const labelsJson = labels.map((l, i) => ({
    case: `judge-${pad(i + 1)}`,
    grader,
    arm: "with",
    run: 1,
    label: l.label,
  }));
  return new Map<string, string>([
    [
      ".claude-plugin/plugin.json",
      `${JSON.stringify({ name: "judge-probe", version: "0.0.1", description: "Throwaway probe built by validate-judge.ts." }, null, 2)}\n`,
    ],
    ["labels.json", `${JSON.stringify(labelsJson, null, 2)}\n`],
    ...cases,
  ]);
};

export const main = (argv: readonly string[], io: Io): Outcome => {
  const fail = (code: 1 | 2, message: string): Outcome => ({ code, stdout: "", stderr: `${message}\n` });
  const parsed = (() => {
    try {
      return parseArgs({
        args: [...argv],
        options: {
          help: { type: "boolean", short: "h" },
          plugin: { type: "string" },
          case: { type: "string" },
          grader: { type: "string" },
          labels: { type: "string" },
          split: { type: "string" },
          "judge-model": { type: "string" },
          out: { type: "string" },
        },
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  })();
  if (typeof parsed === "string") return fail(2, `${parsed}\n${USAGE}`);
  const v = parsed.values;
  if (v.help === true) return { code: 0, stdout: USAGE, stderr: "" };
  if (v.plugin === undefined || v.case === undefined || v.grader === undefined || v.out === undefined) {
    return fail(2, `--plugin, --case, --grader and --out are required\n${USAGE}`);
  }
  if (v.split !== undefined && v.split !== "dev" && v.split !== "test") return fail(2, "--split must be dev or test");

  const loaded = io.load(v.plugin, v.case, v.grader);
  if (typeof loaded === "string") return fail(1, loaded);

  const all = (() => {
    if (v.labels === undefined) {
      return loaded.good === undefined || loaded.bad === undefined
        ? "the case header lacks # good-reply: or # bad-reply:; pass --labels"
        : ([
            { label: "PASS", reply: loaded.good },
            { label: "FAIL", reply: loaded.bad },
          ] as const);
    }
    const text = io.readFile(v.labels);
    return text === undefined ? `cannot read ${v.labels}` : parseLabels(text);
  })();
  if (typeof all === "string") return fail(1, all);
  const labels = all.filter((l) => v.split === undefined || l.split === v.split);
  const passes = labels.filter((l) => l.label === "PASS").length;
  if (passes === 0 || passes === labels.length) {
    return fail(1, `need at least one PASS and one FAIL label${v.split === undefined ? "" : ` in split ${v.split}`}; have ${String(passes)} PASS of ${String(labels.length)}`);
  }

  const out = resolve(v.out);
  for (const [path, text] of probeFiles(out, v.grader, loaded.criteria, labels)) io.writeFile(join(out, path), text);

  const judge = v["judge-model"] === undefined ? "" : ` --judge-model ${v["judge-model"]}`;
  const here = new URL(".", import.meta.url).pathname;
  return {
    code: 0,
    stderr: "",
    stdout:
      `Wrote ${String(labels.length)} stub cases (${String(passes)} PASS, ${String(labels.length - passes)} FAIL) to ${out}\n\n` +
      `1. Paid run (needs the user's go-ahead; --scaffold runs the generated fixture.sh files as you):\n` +
      `   claude plugin eval ${out} --trust-plugin --scaffold --ablation none --runs 1 --model haiku${judge} --threshold 0 --max-cost-usd 1 --no-publish --output-dir ${out}/results\n\n` +
      `2. Free report:\n` +
      `   node ${here}judge-agreement.ts --labels ${out}/labels.json ${out}/results\n`,
  };
};

export const realIo: Io = {
  readFile: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  writeFile: (p, text) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  },
  load: (plugin, caseName, grader) => {
    const c = readSuite(plugin).cases.find((x) => x.dirName === caseName);
    if (c === undefined) return `no case named ${caseName} under ${plugin}`;
    const g = c.graders.find((x): x is LlmGrader => x.type === "llm" && x.name.value === grader);
    if (g === undefined) return `case ${caseName} has no llm grader named ${grader}`;
    const file = c.caseYamlFile ?? c.promptFile;
    const header = headerReplies(file === undefined ? "" : readFileSync(file, "utf8"));
    return { criteria: g.criteria.value, good: header.good, bad: header.bad };
  },
};

if (import.meta.main) {
  const o = main(process.argv.slice(2), realIo);
  process.stdout.write(o.stdout);
  process.stderr.write(o.stderr);
  process.exitCode = o.code;
}
