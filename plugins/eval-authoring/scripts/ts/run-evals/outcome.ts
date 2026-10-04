/**
 * Turns a finished run (CLI exit status, console signals, `aggregate-result.json`)
 * into one wrapper exit code and the reasons for it.
 */
import { join } from "node:path";
import {
  readAggregateResult,
  type AggregateResult,
} from "../parser/index.ts";
import {
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_TERMINATED,
  worstExit,
  type ExitCode,
} from "./exit-codes.ts";
import type { OutputSignals } from "./output.ts";

/** What the CLI's own exit status means (documented codes: 0, 1, 2, 130, 143). */
export type CliMeaning =
  | "pass"
  | "failed"
  | "partial"
  | "interrupted"
  | "terminated"
  | "unknown";

/** Map a status (or terminating signal) to its meaning. */
export const interpretCliExit = (
  status: number | null,
  signal: string | null,
): CliMeaning => {
  if (signal === "SIGINT") return "interrupted";
  if (signal === "SIGTERM") return "terminated";
  return status === 0
    ? "pass"
    : status === 1
      ? "failed"
      : status === 2
        ? "partial"
        : status === 130
          ? "interrupted"
          : status === 143
            ? "terminated"
            : "unknown";
};

/** A run that errored mid-suite. The CLI does not mark a usage or rate limit as `partial`, so later runs score 0 and look like regressions. */
export interface RunError {
  readonly caseName: string;
  readonly arm: "with" | "without";
  /** 1-based run number within the arm. */
  readonly run: number;
  readonly error: string;
}

export interface ResultFindings {
  readonly partial: boolean;
  readonly partialReason: string | undefined;
  readonly runErrors: readonly RunError[];
  /** Cases where paid graders were skipped: that run's score is not comparable. */
  readonly skippedPaidGraders: readonly string[];
}

export const inspectResult = (result: AggregateResult): ResultFindings => ({
  partial: result.partial,
  partialReason: result.partialReason,
  runErrors: result.cases.flatMap((c) =>
    (["with", "without"] as const).flatMap((arm) =>
      (arm === "with" ? c.withRuns : c.withoutRuns).flatMap((r, i) =>
        typeof r.error === "string" && r.error !== ""
          ? [{ caseName: c.name, arm, run: i + 1, error: r.error }]
          : [],
      ),
    ),
  ),
  skippedPaidGraders: result.cases
    .filter((c) =>
      [...c.withRuns, ...c.withoutRuns].some(
        (r) => r.skippedPaidGraders === true,
      ),
    )
    .map((c) => c.name),
});

const AGGREGATE_FILE = "aggregate-result.json";

/** Result directories a run could have written, newest last: the base itself, or its timestamped children. */
export const candidateResultDirs = (
  base: string,
  entries: readonly string[],
): readonly string[] => [base, ...[...entries].sort().map((e) => join(base, e))];

export interface Judgement {
  readonly code: ExitCode;
  /** Human-readable reasons, one per line, empty on a clean pass. */
  readonly reasons: readonly string[];
  /** The wrapper must not run later groups. */
  readonly stop: boolean;
}

export interface JudgeInput {
  readonly status: number | null;
  readonly signal: string | null;
  readonly signals: OutputSignals;
  /** Undefined when the results file was missing or unreadable. */
  readonly findings: ResultFindings | undefined;
  /** Why the results could not be read, when `findings` is undefined. */
  readonly resultProblem: string | undefined;
  /** Exit 0 instead of failing when plugin eval is unavailable (early access / down). */
  readonly skipUnavailable: boolean;
}

/**
 * The mapping of the issue (#460): 0 pass; 1 below threshold, load failure,
 * no cases, untrusted directory or invalid option; 2 partial (cost ceiling or
 * rejected credential); 130 interrupted; 143 terminated. On top of that, the
 * results are checked even when the CLI exits 0, because a run error is not
 * marked partial. Δ never changes the exit code.
 */
const note = (
  code: ExitCode,
  reasons: readonly string[],
  stop: boolean,
): Judgement => ({ code, reasons, stop });

export const judgeRun = (input: JudgeInput): Judgement => {
  const { signals, findings } = input;
  const meaning = interpretCliExit(input.status, input.signal);
  const unavailable =
    meaning !== "pass" && (signals.earlyAccess || signals.unavailable);
  const notes: readonly Judgement[] = [
    ...(meaning === "interrupted"
      ? [note(EXIT_INTERRUPTED, ["the CLI was interrupted"], true)]
      : []),
    ...(meaning === "terminated"
      ? [note(EXIT_TERMINATED, ["the CLI was terminated"], true)]
      : []),
    ...(signals.cannotPass.length > 0
      ? [
          note(EXIT_CONFIG, [
              "the CLI warns a case cannot pass with the granted tools (fix the grants file or the case):",
              ...signals.cannotPass.map((l) => `  ${l}`),
            ], false),
        ]
      : []),
    ...(unavailable
      ? [
          note(input.skipUnavailable ? EXIT_OK : EXIT_DEPENDENCY, [
              `plugin eval is ${signals.earlyAccess ? "in early access for this account" : "currently unavailable"}: not a plugin regression${input.skipUnavailable ? " (skipped by --skip-unavailable)" : " (use --skip-unavailable to treat as a skip)"}`,
            ], true),
        ]
      : []),
    ...(meaning === "partial"
      ? [note(EXIT_PARTIAL, ["partial run: cost ceiling hit or credential rejected"], false)]
      : []),
    ...(meaning === "failed" && !unavailable
      ? [note(EXIT_FAILURE, ["below threshold, or the CLI rejected the run (no cases, untrusted directory, invalid option)"], false)]
      : []),
    ...(meaning === "unknown" && !unavailable
      ? [note(EXIT_FAILURE, [`unexpected CLI exit status ${String(input.status)}`], false)]
      : []),
    ...(findings === undefined
      ? meaning === "pass"
        ? [note(EXIT_FAILURE, [`cannot trust a pass: ${input.resultProblem ?? "results unreadable"}`], false)]
        : []
      : [
          ...(findings.partial
            ? [note(EXIT_PARTIAL, [`result is partial (${findings.partialReason ?? "no reason given"}): later cases did not run`], false)]
            : []),
          ...(findings.runErrors.length > 0
            ? [
                note(EXIT_PARTIAL, [
                    "runs errored, so their scores are 0 and not regressions:",
                    ...findings.runErrors.map(
                      (e) =>
                        `  ${e.caseName} (${e.arm} arm, run ${String(e.run)}): ${e.error}`,
                    ),
                  ], false),
              ]
            : []),
          ...(findings.skippedPaidGraders.length > 0
            ? [
                note(EXIT_PARTIAL, [
                    `paid graders were skipped, so these scores are not comparable: ${findings.skippedPaidGraders.join(", ")}`,
                  ], false),
              ]
            : []),
        ]),
  ];
  return {
    code: notes.reduce<ExitCode>((c, n) => worstExit(c, n.code), EXIT_OK),
    reasons: notes.flatMap((n) => n.reasons),
    stop: notes.some((n) => n.stop),
  };
};

/** Parse a results file's text into findings, or say why not. */
export const findingsFromText = (
  text: string | undefined,
  where: string,
):
  | { readonly findings: ResultFindings; readonly problem: undefined }
  | { readonly findings: undefined; readonly problem: string } => {
  if (text === undefined) {
    return { findings: undefined, problem: `no ${AGGREGATE_FILE} found in ${where}` };
  }
  const parsed = readAggregateResult(text);
  return parsed.ok
    ? { findings: inspectResult(parsed.result), problem: undefined }
    : { findings: undefined, problem: `${where}: ${parsed.reason}` };
};

export { AGGREGATE_FILE };
