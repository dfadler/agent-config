// The smallest per-case delta a plan could tell from noise, before any money is spent (#863).
// Pure arithmetic over a planned run count and a noise estimate; makes no model calls.
import { readFileSync } from "node:fs";
import { readAggregateResult } from "../parser/index.ts";
import { deltaBar, diagnose, type ArmStats } from "../diagnose/verdict.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

export const USAGE = `Usage: power.ts [-h|--help] --runs N (--sd S | --from-result RESULT.json)

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

/** Pooled SD (weighted by degrees of freedom) over every arm with 2 or more usable runs; undefined when none. */
export const pooledSd = (result: Parameters<typeof diagnose>[0]): number | undefined => {
  const arms = diagnose(result).cases.flatMap((c) => [c.with, c.without]);
  const usable = arms.flatMap((a) =>
    a.stdDev !== undefined && a.usedRuns >= 2 ? [{ df: a.usedRuns - 1, sd: a.stdDev }] : [],
  );
  const df = usable.reduce((n, a) => n + a.df, 0);
  return df === 0 ? undefined : Math.sqrt(usable.reduce((n, a) => n + a.df * a.sd ** 2, 0) / df);
};

export interface Io {
  readonly readFile: (path: string) => string | undefined;
}
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
  const known = new Set(["--runs", "--sd", "--from-result"]);
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
  const sdText = flagValue(argv, "--sd");
  const resultPath = flagValue(argv, "--from-result");
  if ((sdText === undefined) === (resultPath === undefined)) {
    return usage("give exactly one of --sd and --from-result");
  }
  const sd = ((): number | string => {
    if (sdText !== undefined) {
      const n = Number(sdText);
      return sdText.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : "--sd needs a number in [0, 1]";
    }
    const text = io.readFile(resultPath ?? "");
    if (text === undefined) return `cannot read ${resultPath ?? ""}`;
    const parsed = readAggregateResult(text);
    if (!parsed.ok) return `${resultPath ?? ""}: ${parsed.reason}`;
    return pooledSd(parsed.result) ?? `${resultPath ?? ""}: no arm has two usable runs, so no SD can be estimated`;
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
  return { code: EXIT_OK, stdout, stderr: "" };
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
