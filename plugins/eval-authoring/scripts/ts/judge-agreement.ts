/**
 * Hand-run (#864, offline half): how stable is each llm judge across saved runs,
 * and, given human labels, how well does it agree with a person. Reads saved
 * results only; it cannot re-run a judge. `node judge-agreement.ts --help`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { graderVotes } from "./diagnose/verdict.ts";
import { readAggregateResult } from "./parser/result.ts";
import { isRec } from "./run-evals/summary.ts";

const USAGE = `Usage: judge-agreement.ts [-h|--help] [--labels FILE] RESULTS...

For every llm grader in saved results, print the judge vote split and the share
of runs whose votes were unanimous or split (a split is the noisy-judge signal).
With --labels, also the judge's agreement with a human, Cohen's kappa and the
true-positive and true-negative rates. Free: reads files, makes no model call.

  RESULTS...    Run directories (every aggregate-result.json under them) or
                aggregate-result.json files.
  --labels FILE JSON array of human labels:
                [{"case": "alpha", "grader": "g", "arm": "with", "run": 1, "label": "PASS"}]
                arm is "with" or "without"; run counts from 1 in the result's
                order; label is PASS or FAIL. A label applies to every result
                with that case, grader, arm and run, so label one run set at a time.

The judge's verdict for a run is the grader's own passed value, else a strict
majority of its votes (a tie is FAIL). PASS is the positive class: TPR is the
share of human PASS the judge passed, TNR the share of human FAIL it failed.

It CANNOT re-run the judge: the saved result keeps the votes, not a rationale,
and the CLI has no regrade flag. A true re-judge needs a direct model call,
which costs money and is the owner's decision.

Exit 0 printed, 1 unreadable input, 2 usage.
`;

export interface Io {
  readonly readFile: (path: string) => string | undefined;
  /** aggregate-result.json paths under `path`, or `[path]` for a file; empty when missing. */
  readonly findResults: (path: string) => readonly string[];
}

export interface Outcome {
  readonly code: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Row {
  readonly key: string;
  readonly grader: string;
  readonly votes: readonly boolean[];
  /** The judge's final verdict, when known. */
  readonly verdict: boolean | undefined;
}

export const labelKey = (c: string, g: string, arm: string, run: number): string =>
  JSON.stringify([c, g, arm, run]);

/** One row per llm grader result, from the result text; `[]` when it has none. */
export const rowsOf = (text: string): readonly Row[] => {
  const read = readAggregateResult(text);
  if (!read.ok) return [];
  return read.result.cases.flatMap((c) =>
    (["with", "without"] as const).flatMap((arm) =>
      (arm === "with" ? c.withRuns : c.withoutRuns).flatMap((r, i) =>
        (r.graders ?? []).flatMap((g) => {
          // Real result entries carry no `type`: a judged grader is one with judgeVotes or a "judge votes:" explanation.
          if (g.type !== "llm" && g.judgeVotes === undefined && !/judge votes:/i.test(g.explanation ?? "")) return [];
          const votes = graderVotes(g).map((v) => v === "PASS");
          const pass = votes.filter(Boolean).length;
          const verdict = g.passed ?? (votes.length === 0 ? undefined : pass * 2 > votes.length);
          return [{ key: labelKey(c.name, g.name ?? "", arm, i + 1), grader: `${c.name} / ${g.name ?? "(unnamed)"}`, votes, verdict }];
        }),
      ),
    ),
  );
};

export interface Stats {
  readonly runs: number;
  readonly noVotes: number;
  readonly pass: number;
  readonly fail: number;
  readonly unanimous: number;
  readonly split: number;
}

export const voteStats = (rows: readonly Row[]): Stats => {
  const voted = rows.filter((r) => r.votes.length > 0);
  const split = voted.filter((r) => new Set(r.votes).size > 1).length;
  const pass = voted.reduce((n, r) => n + r.votes.filter(Boolean).length, 0);
  return {
    runs: rows.length,
    noVotes: rows.length - voted.length,
    pass,
    fail: voted.reduce((n, r) => n + r.votes.length, 0) - pass,
    unanimous: voted.length - split,
    split,
  };
};

export interface Agreement {
  readonly n: number;
  readonly agreement: number;
  /** null when chance agreement is 1 (a single class on both sides): kappa is undefined. */
  readonly kappa: number | null;
  /** null when the human gave no PASS (TPR) or no FAIL (TNR). */
  readonly tpr: number | null;
  readonly tnr: number | null;
}

/** [judge, human] pairs, PASS = true. Callers guard the empty case. */
export const agreement = (pairs: readonly (readonly [boolean, boolean])[]): Agreement => {
  const n = pairs.length;
  const count = (j: boolean, h: boolean): number => pairs.filter(([a, b]) => a === j && b === h).length;
  const tp = count(true, true);
  const tn = count(false, false);
  const judgePass = (tp + count(true, false)) / n;
  const humanPass = (tp + count(false, true)) / n;
  const po = (tp + tn) / n;
  const pe = judgePass * humanPass + (1 - judgePass) * (1 - humanPass);
  const ratio = (a: number, b: number): number | null => (b === 0 ? null : a / b);
  return {
    n,
    agreement: po,
    kappa: pe === 1 ? null : (po - pe) / (1 - pe),
    tpr: ratio(tp, tp + count(false, true)),
    tnr: ratio(tn, tn + count(true, false)),
  };
};

const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null): string => (x === null ? "n/a (one class only)" : x.toFixed(2));

const statLine = (s: Stats): string => {
  const voted = s.unanimous + s.split;
  return (
    `${String(s.runs)} runs, votes PASS ${String(s.pass)} / FAIL ${String(s.fail)}, ` +
    `unanimous ${String(s.unanimous)} (${pct(voted === 0 ? null : s.unanimous / voted)}), split ${String(s.split)}` +
    (s.noVotes > 0 ? `, ${String(s.noVotes)} with no votes recorded` : "")
  );
};

const agreementLine = (a: Agreement): string =>
  `${String(a.n)} labelled: agreement ${pct(a.agreement)}, kappa ${num(a.kappa)}, TPR ${pct(a.tpr)}, TNR ${pct(a.tnr)}`;

type Labels = ReadonlyMap<string, boolean>;

/** Parse the labels file; a string is the reason it is unusable. */
export const parseLabels = (text: string): Labels | string => {
  const doc = ((): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();
  if (!Array.isArray(doc)) return "labels file must be a JSON array";
  const out = new Map<string, boolean>();
  for (const [i, e] of doc.entries()) {
    const o = isRec(e) ? e : {};
    const label = typeof o["label"] === "string" ? o["label"].toUpperCase() : "";
    const run = o["run"];
    if (
      typeof o["case"] !== "string" ||
      typeof o["grader"] !== "string" ||
      (o["arm"] !== "with" && o["arm"] !== "without") ||
      typeof run !== "number" ||
      !Number.isInteger(run) ||
      run < 1 ||
      (label !== "PASS" && label !== "FAIL")
    ) {
      return `label ${String(i + 1)}: needs case, grader, arm (with|without), run (1, 2, ...) and label (PASS|FAIL)`;
    }
    out.set(labelKey(o["case"], o["grader"], o["arm"], run), label === "PASS");
  }
  return out;
};

const NOTE =
  "Note: this cannot re-run the judge. A saved result keeps the votes, not a rationale, and the CLI has no regrade flag.\n" +
  "A true re-judge needs a direct model call, which costs money and is the owner's decision.\n";

export const report = (rows: readonly Row[], labels: Labels | undefined): string => {
  if (rows.length === 0) return `No llm graders found in the results; nothing to report.\n${NOTE}`;
  const byGrader = new Map<string, Row[]>();
  for (const r of rows) byGrader.set(r.grader, [...(byGrader.get(r.grader) ?? []), r]);
  const lines = [`Judge votes (${String(byGrader.size)} llm graders)`, `all: ${statLine(voteStats(rows))}`];
  for (const [g, rs] of byGrader) lines.push(`- ${g}: ${statLine(voteStats(rs))}`);
  if (labels !== undefined) {
    const pairs = (rs: readonly Row[]): (readonly [boolean, boolean])[] =>
      rs.flatMap((r) => {
        const h = labels.get(r.key);
        return h === undefined || r.verdict === undefined ? [] : [[r.verdict, h] as const];
      });
    const all = pairs(rows);
    lines.push("", `Agreement with human labels (${String(labels.size)} labels given, ${String(all.length)} matched a judged run)`);
    if (all.length === 0) lines.push("no label matched a judged run (check case, grader, arm and run)");
    else {
      lines.push(`all: ${agreementLine(agreement(all))}`);
      for (const [g, rs] of byGrader) {
        const p = pairs(rs);
        if (p.length > 0) lines.push(`- ${g}: ${agreementLine(agreement(p))}`);
      }
    }
  }
  return `${lines.join("\n")}\n\n${NOTE}`;
};

const fail = (code: 1 | 2, message: string): Outcome => ({
  code,
  stdout: "",
  stderr: code === 2 ? `${message}\n\n${USAGE}` : `${message}\n`,
});

export const main = (argv: readonly string[], io: Io): Outcome => {
  if (argv.includes("-h") || argv.includes("--help")) return { code: 0, stdout: USAGE, stderr: "" };
  let labelsPath: string | undefined;
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--labels") {
      labelsPath = argv[++i];
      if (labelsPath === undefined) return fail(2, "--labels needs a value");
    } else if (a.startsWith("-")) return fail(2, `unknown option ${a}`);
    else inputs.push(a);
  }
  if (inputs.length === 0) return fail(2, "expected at least one RESULTS path");
  let labels: Labels | undefined;
  if (labelsPath !== undefined) {
    const text = io.readFile(labelsPath);
    if (text === undefined) return fail(1, `cannot read ${labelsPath}`);
    const parsed = parseLabels(text);
    if (typeof parsed === "string") return fail(1, `${labelsPath}: ${parsed}`);
    labels = parsed;
  }
  const rows: Row[] = [];
  for (const input of inputs) {
    const files = io.findResults(input);
    if (files.length === 0) return fail(1, `no aggregate-result.json at ${input}`);
    for (const f of files) {
      const text = io.readFile(f);
      if (text === undefined) return fail(1, `cannot read ${f}`);
      if (!readAggregateResult(text).ok) return fail(1, `${f}: not a readable aggregate-result.json`);
      rows.push(...rowsOf(text));
    }
  }
  return { code: 0, stdout: report(rows, labels), stderr: "" };
};

const nodeIo: Io = {
  readFile: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  findResults: (p) => {
    if (!existsSync(p)) return [];
    return statSync(p).isDirectory()
      ? readdirSync(p, { recursive: true, encoding: "utf8" })
          .filter((f) => f.endsWith("aggregate-result.json"))
          .sort()
          .map((f) => join(p, f))
      : [p];
  },
};

if (import.meta.main) {
  const out = main(process.argv.slice(2), nodeIo);
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}
