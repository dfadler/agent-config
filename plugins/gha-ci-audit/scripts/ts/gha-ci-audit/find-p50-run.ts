// Find the successful workflow run whose duration is closest to the p50.
//
// Usage:
//   node find-p50-run.ts runs.json
//   gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | node find-p50-run.ts
//
// Output (one line): <run_id>  <duration_min>m  <created_at>
// Use the run_id with analyze-jobs.ts for critical-path analysis.
import { defaultIo, median, readJson, spanMinutes, str, unwrapList, type Io } from "./common.ts";

export interface P50Result {
  readonly runId: number;
  readonly durationMin: number;
  readonly createdAt: string;
  readonly p50: number;
  readonly n: number;
}

/** `raw` is a runs API response (`{workflow_runs: [...]}`) or a bare list of runs. */
export const findP50Run = (raw: unknown): P50Result | null => {
  const withDur = unwrapList(raw, "workflow_runs")
    .filter((r) => r["conclusion"] === "success")
    .flatMap((r) => {
      const d = spanMinutes(str(r["run_started_at"]), str(r["updated_at"]));
      return d === null ? [] : [{ d, r }];
    });
  const first = withDur[0];
  if (first === undefined) return null;
  const p50 = median(withDur.map((x) => x.d));
  // Earliest wins a tie, like Python's min().
  const best = withDur.reduce((a, b) => (Math.abs(b.d - p50) < Math.abs(a.d - p50) ? b : a), first);
  return {
    runId: Number(best.r["id"]),
    durationMin: best.d,
    createdAt: str(best.r["created_at"]) ?? "",
    p50,
    n: withDur.length,
  };
};

export const main = (argv: string[], io: Io = defaultIo): number => {
  if (argv.length > 1 || argv[0] === "-h" || argv[0] === "--help") {
    io.err("Usage: find-p50-run.ts [runs.json]\n");
    return argv.length > 1 ? 2 : 0;
  }
  try {
    const result = findP50Run(readJson(io, argv[0]));
    if (result === null) {
      io.err("No successful runs with duration data found.\n");
      return 1;
    }
    io.out(`${String(result.runId)}  ${result.durationMin.toFixed(1)}m  ${result.createdAt}\n`);
    io.err(`# p50=${result.p50.toFixed(1)}m  n=${String(result.n)} successful runs\n`);
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
