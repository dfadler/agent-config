// The smallest per-case delta (and, given a case count, the smallest suite-mean delta) a plan could
// tell from noise, before any money is spent (#863). Pure arithmetic over a planned run count and a
// noise estimate; makes no model calls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readAggregateResult, type AggregateResult } from "../parser/index.ts";
import { deltaBar, diagnose, tCutoff, type ArmStats } from "../diagnose/verdict.ts";
import { candidateResultDirs } from "./outcome.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

export const USAGE = `Usage: power.ts [-h|--help] --runs N (--sd S | --from-result RESULT.json) [--cases N]

Print the smallest delta one case could show at 95% confidence with N runs per
arm, given the per-run score standard deviation S (scores run 0 to 1). It is the
same cutoff diagnose.ts applies (t quantile x standard error of the difference,
the SE floored at 0.05): a delta below it reads as weak-signal. No model calls.

  --runs N              Planned runs per arm (an integer, at least 2).
  --sd S                Per-run score standard deviation, in [0, 1]. There is
                        no default: none is recorded for this repo.
  --from-result FILE    Use the pooled SD of the arms in an earlier
                        aggregate-result.json instead of --sd. Arms that
                        pass or fail every run have SD 0 and pull the pool
                        down, so the cutoff is optimistic for a suite with
                        many ceiling or floor cases.
  --cases N             Also print the smallest suite-mean delta, averaged
                        over N cases (an integer, at least 1). The SE of the
                        mean of N independent per-case deltas is the per-case
                        SE over sqrt(N), floor included, with the t quantile at
                        N x (runs - 1) degrees of freedom. It assumes cases are
                        independent and share one SD, and leaves out how much
                        the true deltas differ between cases, so it is a floor.
  -h, --help            Show this message and exit.

Exit codes: 0 printed, 1 unreadable result or no SD in it, 2 usage error.
`;

/** An arm as the cutoff sees it: `runs` usable runs with SD `stdDev`. */
const arm = (runs: number, stdDev: number): ArmStats => ({ runs, usedRuns: runs, stdDev });

/**
 * Smallest delta that clears the 95% bar at `runs` per arm with per-run SD
 * `sd`; undefined below 2 runs, where noise cannot be estimated. A delta this
 * size is detected about half the time, not reliably (see the run-evals skill).
 */
export const smallestDetectableDelta = (
  runs: number,
  sd: number,
  seFloor?: number,
): number | undefined =>
  runs < 2 ? undefined : deltaBar(arm(runs, sd), arm(runs, sd), seFloor).bar;

/**
 * Smallest suite-mean delta that clears the same 95% bar when the mean is taken over `cases`
 * independent cases at `runs` per arm each: the per-case SE (floor included) over sqrt(cases),
 * times the t quantile at cases x (runs - 1) degrees of freedom. Equals the per-case cutoff at one
 * case. Leaves out between-case spread of the true deltas, so it is a lower bound. Undefined below
 * 2 runs or 1 case.
 */
export const smallestSuiteDelta = (
  runs: number,
  sd: number,
  cases: number,
  seFloor?: number,
): number | undefined =>
  runs < 2 || cases < 1
    ? undefined
    : (tCutoff(cases * (runs - 1)) ?? 2) * (deltaBar(arm(runs, sd), arm(runs, sd), seFloor).se / Math.sqrt(cases));

/** Pooled SD (weighted by degrees of freedom) over every arm of `results` with 2 or more usable runs; undefined when none. */
export const pooledSd = (results: readonly AggregateResult[]): number | undefined => {
  const arms = results.flatMap((r) => diagnose(r).cases.flatMap((c) => [c.with, c.without]));
  const usable = arms.flatMap((a) =>
    a.stdDev !== undefined && a.usedRuns >= 2 ? [{ df: a.usedRuns - 1, sd: a.stdDev }] : [],
  );
  const df = usable.reduce((n, a) => n + a.df, 0);
  return df === 0 ? undefined : Math.sqrt(usable.reduce((n, a) => n + a.df * a.sd ** 2, 0) / df);
};

/** `--sd` text as a number in [0, 1]; undefined for anything else. */
export const parseSd = (text: string): number | undefined => {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : undefined;
};

export interface Io {
  readonly readFile: (path: string) => string | undefined;
}
interface ResultsIo extends Io {
  readonly listDir: (path: string) => readonly string[];
}

/**
 * The pooled SD of the newest wrapper run under `resultsDir` (`run-<time>/<NN>-<case>/aggregate-result.json`,
 * one result per case), and that run's directory name; the next-newest run when a newer one has no
 * readable result with an SD. Undefined when none does.
 */
export const newestRunSd = (
  io: ResultsIo,
  resultsDir: string,
): { readonly sd: number; readonly source: string } | undefined =>
  io
    .listDir(resultsDir)
    .filter((e) => e.startsWith("run-"))
    .toSorted()
    .toReversed()
    .flatMap((run) => {
      const runDir = join(resultsDir, run);
      const results = io.listDir(runDir).flatMap((inv) => {
        const text = candidateResultDirs(join(runDir, inv), io.listDir(join(runDir, inv)))
          .toReversed()
          .map((d) => io.readFile(join(d, "aggregate-result.json")))
          .find((t) => t !== undefined);
        const parsed = text === undefined ? undefined : readAggregateResult(text);
        return parsed?.ok === true ? [parsed.result] : [];
      });
      const sd = pooledSd(results);
      return sd === undefined ? [] : [{ sd, source: `results/${run}` }];
    })[0];

/** A cutoff as text; a cutoff of 1 or more is past the 0-to-1 score range. */
const shown = (delta: number): string =>
  delta >= 1 ? `none (it would need to be ${delta.toFixed(2)})` : delta.toFixed(2);

/** The suite-mean line: "" when the cutoff is undefined (under 2 runs or no cases). */
const suiteLine = (runs: number, sd: number, cases: number): string => {
  const delta = smallestSuiteDelta(runs, sd, cases);
  return delta === undefined
    ? ""
    : `smallest suite-mean delta over ${String(cases)} case(s) at ${String(runs)} runs: ${shown(delta)}\n`;
};

/**
 * The `--dry-run` line for a two-arm plan of `runs` per arm: the cutoff when `sd` is known, else
 * one line saying what it needs. Never invents an SD.
 */
export const detectableLine = (
  runs: number,
  known: { readonly sd: number; readonly source: string } | undefined,
  cases?: number,
): string => {
  const delta = known === undefined ? undefined : smallestDetectableDelta(runs, known.sd);
  return known === undefined || delta === undefined
    ? `smallest detectable delta: not shown; it needs an SD. Pass --sd S or run once first, or run: node scripts/ts/run-evals/power.ts --runs ${String(runs)} --sd S\n`
    : `smallest detectable delta at ${String(runs)} runs: ${shown(delta)} (SD ${known.sd.toFixed(2)} from ${known.source})\n` +
        (cases === undefined ? "" : suiteLine(runs, known.sd, cases));
};
export interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const usage = (message: string): Outcome => ({ code: EXIT_USAGE, stdout: "", stderr: `${message}\n${USAGE}` });

const flagValue = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : (argv[at + 1] ?? "");
};

export const main = (argv: readonly string[], io: Io): Outcome => {
  if (argv.includes("-h") || argv.includes("--help")) return { code: EXIT_OK, stdout: USAGE, stderr: "" };
  const known = new Set(["--runs", "--sd", "--from-result", "--cases"]);
  const stray = argv.find((a) => a.startsWith("--") && !known.has(a));
  if (stray !== undefined) return usage(`unknown option ${stray}`);
  const dangling = [...known].find((f) => {
    const at = argv.indexOf(f);
    return at !== -1 && (argv[at + 1] === undefined || argv[at + 1]?.startsWith("--") === true);
  });
  if (dangling !== undefined) return usage(`${dangling} needs a value`);
  const runsText = flagValue(argv, "--runs");
  const runs = Number(runsText);
  if (runsText === undefined || !Number.isInteger(runs) || runs < 2) {
    return usage("--runs needs an integer of at least 2");
  }
  const casesText = flagValue(argv, "--cases");
  const cases = casesText === undefined ? undefined : Number(casesText);
  if (cases !== undefined && (!Number.isInteger(cases) || cases < 1)) {
    return usage("--cases needs an integer of at least 1");
  }
  const sdText = flagValue(argv, "--sd");
  const resultPath = flagValue(argv, "--from-result");
  if ((sdText === undefined) === (resultPath === undefined)) {
    return usage("give exactly one of --sd and --from-result");
  }
  const sd = ((): number | string => {
    if (sdText !== undefined) {
      return parseSd(sdText) ?? "--sd needs a number in [0, 1]";
    }
    const text = io.readFile(resultPath ?? "");
    if (text === undefined) return `cannot read ${resultPath ?? ""}`;
    const parsed = readAggregateResult(text);
    if (!parsed.ok) return `${resultPath ?? ""}: ${parsed.reason}`;
    return pooledSd([parsed.result]) ?? `${resultPath ?? ""}: no arm has two usable runs, so no SD can be estimated`;
  })();
  if (typeof sd === "string") {
    return sdText === undefined
      ? { code: EXIT_FAILURE, stdout: "", stderr: `${sd}\n` }
      : usage(sd);
  }
  const delta = smallestDetectableDelta(runs, sd);
  if (delta === undefined) throw new Error("unreachable: --runs was validated as at least 2");
  const head = `With ${String(runs)} runs per arm and a per-run SD of ${sd.toFixed(2)}`;
  // Scores run 0 to 1, so a delta of 1 or more cannot happen.
  const stdout =
    delta >= 1
      ? `${head}, no delta can clear the 95% bar at ${String(runs)} runs per arm (it would need to be ${delta.toFixed(2)}).\n`
      : `${head}, a case cannot show a delta under ${delta.toFixed(2)} apart from noise at 95% confidence; a true delta this size clears it about half the time.\n`;
  const suite = cases === undefined ? undefined : smallestSuiteDelta(runs, sd, cases);
  const suiteOut =
    cases === undefined || suite === undefined
      ? ""
      : suite >= 1
        ? `Averaged over ${String(cases)} case(s), no suite-mean delta can clear the 95% bar (it would need to be ${suite.toFixed(2)}).\n`
        : `Averaged over ${String(cases)} case(s), a suite-mean delta under ${suite.toFixed(2)} cannot be told from noise at 95% confidence (a cutoff, not a power calculation; it assumes independent cases and ignores how much true deltas differ between cases).\n`;
  return { code: EXIT_OK, stdout: stdout + suiteOut, stderr: "" };
};

if (import.meta.main) {
  const out = main(process.argv.slice(2), {
    readFile: (p) => {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return undefined;
      }
    },
  });
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}
