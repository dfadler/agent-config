/**
 * Offline check (#763): run each case's free `regex` graders on `last_message`
 * against the reference-good and known-bad replies written in the case.yaml
 * header, with no model call. `node check-replies.ts [--require] [PLUGIN_ROOT]`.
 *
 * Header convention (comment lines before the first key; continuation lines
 * are comments indented by two or more spaces):
 *   # good-reply: <text>
 *   # bad-reply: <text>
 *
 * Every regex grader must pass the good reply and at least one must fail the
 * bad one. `llm` graders cannot be run offline: a case with only those is
 * reported "unchecked". A case with an `llm` grader and no header replies is
 * reported "missing" (so is a regex-only case); that is an error only with --require.
 *
 * Probe (#859): `node check-replies.ts --probe CASE --reply - [PLUGIN_ROOT] <<'__REPLY__'`
 * runs the same regex graders on the reply read from stdin and prints pass/FAIL per
 * grader, so the grader-red-team agent can test a wrong reply without writing a file or
 * putting reply text in a shell argument. Exits 0 (2 on an unknown case, a missing reply
 * or a bad flag): a FAIL there is the wanted result for a wrong reply.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { readSuite, type EvalCase, type RegexGrader } from "./parser/index.ts";

export interface Replies {
  readonly good: string | undefined;
  readonly bad: string | undefined;
}

/** Read `good-reply:` and `bad-reply:` from the leading comment block. */
export const headerReplies = (yaml: string): Replies => {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  const lines = yaml.split("\n");
  // prompt.md cases keep the header as comments just inside the `---` frontmatter.
  if (lines[0]?.trim() === "---") lines.shift();
  for (const line of lines) {
    if (!line.startsWith("#")) break;
    const m = /^# (good|bad)-reply:\s?(.*)$/.exec(line);
    if (m !== null) {
      current = m[2] === "" ? [] : [m[2] ?? ""];
      found.set(m[1] ?? "", current);
    } else if (current !== undefined && line.startsWith("#  ")) {
      current.push(line.slice(3).trim());
    } else {
      current = undefined;
    }
  }
  const text = (k: string): string | undefined => found.get(k)?.join("\n");
  return { good: text("good"), bad: text("bad") };
};

/** Does a regex grader pass on this reply? `contains`, `not_contains` or `count:N`. */
export const regexPasses = (g: RegexGrader, reply: string): boolean => {
  const flags = [...new Set(`${g.flags.value ?? ""}g`)].join("");
  const n = [...reply.matchAll(new RegExp(g.pattern.value, flags))].length;
  const mode = g.match.value;
  if (mode === "not_contains") return n === 0;
  const count = /^count:(\d+)$/.exec(mode);
  return count !== null ? n === Number(count[1]) : n > 0;
};

/** One line per grader: `pass|FAIL <name>` for a `last_message` regex, else `not-run <name> (<type>)`. */
export const probeCase = (c: EvalCase, reply: string): readonly string[] =>
  c.graders.map((g) => {
    const name = g.name.value ?? "(unnamed)";
    return g.type === "regex" && g.target.value.kind === "last_message"
      ? `${regexPasses(g, reply) ? "pass" : "FAIL"} ${name}`
      : `not-run ${name} (${g.type})`;
  });

export type Status = "ok" | "unchecked" | "missing" | "fail" | "skipped";
export interface CaseReport {
  readonly name: string;
  readonly status: Status;
  readonly detail: string;
}

const regexGraders = (c: EvalCase): readonly RegexGrader[] =>
  c.graders.filter(
    (g): g is RegexGrader => g.type === "regex" && g.target.value.kind === "last_message",
  );

export const checkCase = (c: EvalCase, replies: Replies): CaseReport => {
  const name = c.dirName;
  const checkable =
    regexGraders(c).length > 0 || c.graders.some((g) => g.type === "llm" || g.type === "baseline");
  const { good, bad } = replies;
  if (good === undefined && bad === undefined) {
    return checkable
      ? { name, status: "missing", detail: "no good-reply/bad-reply in the header" }
      : { name, status: "skipped", detail: "no llm or last_message regex grader" };
  }
  if (good === undefined || bad === undefined) {
    return { name, status: "missing", detail: `header lacks ${good === undefined ? "good" : "bad"}-reply` };
  }
  const regexes = regexGraders(c);
  const failsGood = regexes.filter((g) => !regexPasses(g, good)).map((g) => g.name.value ?? "(unnamed)");
  if (failsGood.length > 0) {
    return { name, status: "fail", detail: `good-reply fails: ${failsGood.join(", ")}` };
  }
  if (regexes.length === 0) {
    return { name, status: "unchecked", detail: "no regex grader on last_message; judge graders need a paid run" };
  }
  if (regexes.every((g) => regexPasses(g, bad))) {
    return { name, status: "fail", detail: "no regex grader fails the bad-reply" };
  }
  return { name, status: "ok", detail: "good passes, bad fails" };
};

export const checkPlugin = (pluginRoot: string): readonly CaseReport[] => {
  const suite = readSuite(pluginRoot);
  if (suite.cases.length === 0) {
    const why = suite.issues.map((i) => i.message).join("; ");
    throw new Error(`no eval cases found under ${pluginRoot}${why === "" ? "" : `: ${why}`}`);
  }
  return suite.cases.map((c) => {
    const file = c.caseYamlFile ?? c.promptFile;
    return checkCase(c, headerReplies(file === undefined ? "" : readFileSync(file, "utf8")));
  });
};

/** Exit 1 on a `fail`, or on `missing` when `require` is set. */
export const exitCode = (reports: readonly CaseReport[], require: boolean): number =>
  reports.some((r) => r.status === "fail" || (require && r.status === "missing")) ? 1 : 0;

/** The probe's reply: stdin for `--reply -` or no `--reply`, else the literal value. Undefined when empty. */
const readReply = (flag: string | undefined): string | undefined => {
  const text =
    flag !== undefined && flag !== "-"
      ? flag
      : process.stdin.isTTY
        ? ""
        : readFileSync(0, "utf8").replace(/\r?\n$/, ""); // a heredoc adds one newline
  return text === "" ? undefined : text;
};

const main = (): number => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { require: { type: "boolean" }, probe: { type: "string" }, reply: { type: "string" } },
  });
  const root = positionals[0] ?? ".";
  if (values.probe !== undefined) {
    const reply = readReply(values.reply);
    if (reply === undefined) throw new Error("--probe needs a reply on stdin: pass `--reply -` and a heredoc");
    const c = readSuite(root).cases.find((x) => x.dirName === values.probe);
    if (c === undefined) throw new Error(`no case named ${values.probe} under ${root}`);
    process.stdout.write(`${probeCase(c, reply).join("\n")}\n`);
    return 0;
  }
  const reports = checkPlugin(root);
  for (const r of reports) {
    if (r.status !== "skipped") process.stdout.write(`${r.status.padEnd(9)} ${r.name}: ${r.detail}\n`);
  }
  return exitCode(reports, values.require === true);
};

if (import.meta.main) {
  try {
    process.exitCode = main();
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}
