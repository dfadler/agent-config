// Plugin-eval result checker (#583), called by the plugin-evals workflow after
// `claude plugin eval`. Decision record: docs/plugin-eval-ci.md (#436).
//
//   check-plugin-eval.ts --cli-exit N --threshold T [--delta-floor F] aggregate-result.json
//
// Exit codes: 0 pass, 1 regression (valid run, CLI exit non-zero against the
// threshold), 7 inconclusive (invalid run, so not a regression), 2 usage.
import type { AggregateResult } from "../../plugins/eval-authoring/scripts/ts/parser/index.ts";
import { diagnose, type Diagnosis } from "../../plugins/eval-authoring/scripts/ts/diagnose/verdict.ts";
import {
  implausibleReasons,
  readAggregateResult,
  silentZeroReasons,
} from "../../plugins/eval-authoring/scripts/ts/parser/result.ts";
import { parseArgs, type Parsed } from "./lib/args.ts";
import {
  cliError,
  EXIT_FAILURE,
  EXIT_PARTIAL,
  EXIT_USAGE,
  type CliError,
} from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, err, fromThrowable, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";
import { describeThrown } from "./lib/thrown.ts";

const USAGE = `Usage: check-plugin-eval.ts [-h|--help] --cli-exit N --threshold T [--delta-floor F] RESULT.json

Decide pass / regression / inconclusive for a \`claude plugin eval\` run.

  --cli-exit N     Exit code the eval CLI returned (run with --threshold T).
  --threshold T    The threshold the CLI was given; reported in messages.
  --delta-floor F  Opt-in gate (#736): the mean delta over cases with a delta
                   must reach F (CI uses 0.14) or the run is a regression.
                   Advisory (warn, exit 0) under 16 cases. Per-case
                   verdicts come from diagnose() and only warn. pass^k
                   (share of cases whose with-plugin runs all scored 1) is
                   reported alongside the mean score.
  RESULT.json      The run's aggregate-result.json.

Inconclusive (exit 7, not a regression): CLI exit 2, \`partial: true\`, any
\`skippedPaidGraders\`, any \`arms.with[].error\` or \`arms.without[].error\`, an implausible result
(no cases, a case with no with-arm runs, wrong \`schemaVersion\`, a score-0 run with
no grader detail, all runs 0: a usage limit looks like this), or an unreadable result.
Regression (exit 1): a valid run where the CLI exited non-zero.
A missing delta means no signal. Exit 2: bad arguments.

  -h, --help       Show this message and exit.
`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** Reasons the run cannot be trusted; empty when it is valid. */
const invalidReasons = (doc: Record<string, unknown>): readonly string[] => [
  ...(doc["partial"] === true ? ["partial: true"] : []),
  ...list(doc["cases"]).flatMap((c) => {
    if (!isRecord(c)) return [];
    const name = String(c["name"]);
    const arms = isRecord(c["arms"]) ? c["arms"] : {};
    return (["with", "without"] as const).flatMap((side) =>
      list(arms[side]).flatMap((a) =>
        !isRecord(a)
          ? []
          : [
              ...(a["error"] != null
                ? [`${name}: ${side} arm error: ${JSON.stringify(a["error"])}`]
                : []),
              ...(a["skippedPaidGraders"] === true
                ? [`${name}: ${side} arm skippedPaidGraders`]
                : []),
            ],
      ),
    );
  }),
];

/**
 * Cases a plugin needs before the delta gate can fail a run (#736). Below it the
 * gate only warns: with fewer cases the plugin-level mean delta is too noisy
 * (about 80 runs per arm are needed to separate a +0.2 effect). The issue gives
 * a 16 to 26 range; this is the low end.
 */
export const MIN_GATE_CASES = 16;

const mean = (xs: readonly number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;

/** Per-case verdicts that deserve a look, from the shared `diagnose()` rules. */
const verdictWarnings = (d: Diagnosis): readonly string[] =>
  d.cases
    .filter((c) =>
      ["negative-delta", "no-discrimination", "weak-signal"].includes(
        c.verdict,
      ),
    )
    .map((c) => `warning: ${c.name}: ${c.verdict}: ${c.reason}\n`);

/** Mean with-arm score and pass^k (share of cases whose with-arm runs all scored 1). */
const reliabilityLine = (r: AggregateResult): string => {
  const cs = r.cases
    .map((c) => c.withRuns.flatMap((x) => (x.score === undefined ? [] : [x.score])))
    .filter((s) => s.length > 0);
  if (cs.length === 0) return "";
  const passK = cs.filter((s) => s.every((x) => x >= 1)).length / cs.length;
  return `with-plugin mean ${mean(cs.map(mean)).toFixed(2)}, pass^k ${passK.toFixed(2)} (${String(cs.length)} cases)\n`;
};

/**
 * Plugin-level gate: the mean delta over cases with a delta signal must reach
 * `floor`. Returns a breach message (when gating) or a warning (advisory).
 */
const deltaGate = (
  d: Diagnosis,
  floor: number,
): { readonly breach?: string; readonly warn?: string } => {
  const deltas = d.cases.flatMap((c) => (c.delta === undefined ? [] : [c.delta]));
  if (deltas.length === 0) return {};
  const m = mean(deltas);
  if (m >= floor) return {};
  const msg = `mean delta ${m.toFixed(2)} over ${String(deltas.length)} cases < floor ${String(floor)}`;
  return deltas.length < MIN_GATE_CASES
    ? { warn: `warning: ${msg} (advisory: under ${String(MIN_GATE_CASES)} cases)\n` }
    : { breach: msg };
};

/** Cases with no delta (plugin-arm-only): the delta gate cannot see them (#738). */
const ungatedNotes = (doc: Record<string, unknown>): string =>
  list(doc["cases"])
    .flatMap((c) =>
      isRecord(c) &&
      (!isRecord(c["aggregates"]) ||
        typeof c["aggregates"]["delta"] !== "number")
        ? [`- ungated by delta (no-plugin arm absent): ${String(c["name"])}\n`]
        : [],
    )
    .join("");

const inconclusive = (why: string): Result<CliError, never> =>
  err(cliError(EXIT_PARTIAL, `inconclusive: ${why}`));

const parseCliExit = (v: unknown): Result<CliError, number> => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0
    ? ok(n)
    : err(
        cliError(
          EXIT_USAGE,
          `--cli-exit needs a non-negative integer\n\n${USAGE}`,
        ),
      );
};

const decide = (
  cliExit: number,
  threshold: string,
  floor: number | undefined,
  text: string,
  doc: unknown,
): Result<CliError, string> => {
  if (cliExit === 2) return inconclusive("eval CLI exited 2 (invalid run)");
  if (!isRecord(doc)) return inconclusive("result is not a JSON object");
  if (!Array.isArray(doc["cases"]))
    return inconclusive("result is missing a cases array");
  const bad = [
    ...implausibleReasons(doc),
    ...silentZeroReasons(doc),
    ...invalidReasons(doc),
  ];
  if (bad.length > 0) return inconclusive(bad.join("; "));
  const parsed = readAggregateResult(text);
  if (!parsed.ok) return inconclusive(parsed.reason);
  const diagnosis = diagnose(parsed.result);
  const gate = floor === undefined ? {} : deltaGate(diagnosis, floor);
  const warns =
    verdictWarnings(diagnosis).join("") +
    (gate.warn ?? "") +
    ungatedNotes(doc) +
    reliabilityLine(parsed.result);
  if (gate.breach !== undefined) {
    return err(cliError(EXIT_FAILURE, `${warns}regression: ${gate.breach}`));
  }
  return cliExit === 0
    ? ok(`${warns}pass: threshold ${threshold} met\n`)
    : err(
        cliError(
          EXIT_FAILURE,
          `${warns}regression: CLI exit ${String(cliExit)} against threshold ${threshold}`,
        ),
      );
};

export const main: Main = (argv, _env, io) =>
  pipe(
    parseArgs(
      {
        usage: USAGE,
        flags: [
          { name: "cli-exit", valued: true },
          { name: "threshold", valued: true },
          { name: "delta-floor", valued: true },
        ],
        minPositionals: 1,
        maxPositionals: 1,
      },
      argv,
    ),
    andThen((p: Parsed): Result<CliError, string> => {
      if (p.kind === "help") return ok(p.usage);
      const threshold = p.flags["threshold"];
      const path = p.positionals[0];
      if (typeof threshold !== "string" || path === undefined) {
        return err(cliError(EXIT_USAGE, `--threshold is required\n\n${USAGE}`));
      }
      const rawFloor = p.flags["delta-floor"];
      const floor = 
        typeof rawFloor === "string" && rawFloor.trim() !== ""
          ? Number(rawFloor)
          : typeof rawFloor === "string"
            ? Number.NaN
            : undefined;
      if (floor !== undefined && !Number.isFinite(floor)) {
        return err(
          cliError(EXIT_USAGE, `--delta-floor needs a number\n\n${USAGE}`),
        );
      }
      return pipe(
        parseCliExit(p.flags["cli-exit"]),
        andThen((cliExit) => {
          // An unreadable or unparseable result means the run is untrustworthy.
          const doc = pipe(
            io.readFile(path),
            andThen((text) =>
              fromThrowable(
                () => {
                  const value: unknown = JSON.parse(text);
                  return { text, value };
                },
                (t) => cliError(EXIT_PARTIAL, describeThrown(t)),
              ),
            ),
          );
          return doc.tag === "err"
            ? inconclusive(`${path}: ${doc.error.message}`)
            : decide(cliExit, threshold, floor, doc.value.text, doc.value.value);
        }),
      );
    }),
  );

if (import.meta.main) run(main);
