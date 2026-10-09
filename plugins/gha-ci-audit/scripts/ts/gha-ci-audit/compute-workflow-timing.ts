// Compute avg and p90 duration (minutes) for a list of workflow runs.
//
// Reads a JSON array of {s, e} runs from stdin (as produced by
// `gh api .../runs --jq '[.workflow_runs[] | ...]'`).
// Output: one line, "<avg_min>  <p90_min>", or "?  ?" if there is no data.
import { defaultIo, isObject, mean, spanMinutes, str, type Io } from "./common.ts";

export const computeWorkflowTiming = (runs: unknown): string => {
  const durs = (Array.isArray(runs) ? runs : [])
    .filter(isObject)
    .map((r) => spanMinutes(str(r["s"]), str(r["e"])))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  if (durs.length === 0) return "?  ?";
  const p90 = durs[Math.floor(durs.length * 0.9)] ?? 0;
  return `${mean(durs).toFixed(1)}  ${p90.toFixed(1)}`;
};

/** Unparseable stdin is "no data", not an error: the caller is a shell pipeline. */
export const main = (_argv: string[], io: Io = defaultIo): number => {
  let runs: unknown;
  try {
    runs = JSON.parse(io.stdin());
  } catch {
    runs = null;
  }
  io.out(computeWorkflowTiming(runs) + "\n");
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
