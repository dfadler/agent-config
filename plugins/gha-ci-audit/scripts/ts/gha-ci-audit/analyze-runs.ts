// Analyze GitHub Actions workflow run timing and outcomes.
//
// Usage:
//   gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | node analyze-runs.ts
//   node analyze-runs.ts runs.json [--group-by conclusion|event]
import { parseArgs } from "node:util";
import {
  defaultIo,
  mean,
  median,
  readJson,
  spanMinutes,
  stdev,
  str,
  unwrapList,
  type Io,
  type Json,
} from "./common.ts";

const USAGE = `Usage: analyze-runs.ts [file] [--group-by conclusion|event]
Reads workflow-runs JSON from file, or stdin when omitted.
`;

/** Accepts both the full API shape and the pre-projected {s, e} shape. */
export const runDurationMin = (r: Json): number | null =>
  spanMinutes(
    str(r["run_started_at"]) ?? str(r["s"]),
    str(r["updated_at"]) ?? str(r["e"]),
  );

const BUCKETS: readonly (readonly [string, number, number])[] = [
  ["<2m", 0, 2],
  ["2–5m", 2, 5],
  ["5–15m", 5, 15],
  ["15–30m", 15, 30],
  [">30m", 30, Infinity],
];

export const analyzeRuns = (raw: unknown, groupBy: "conclusion" | "event"): string => {
  const runs = unwrapList(raw, "workflow_runs");
  const completed = runs.filter((r) => {
    const c = r["conclusion"];
    return typeof c === "string" && c !== "" && c !== "skipped";
  });
  if (completed.length === 0) return "No completed runs found.\n";

  const lines: string[] = [
    `Completed runs: ${String(completed.length)}  (total in payload: ${String(runs.length)})`,
    "",
  ];
  const groups = new Map<string, number[]>();
  let noDuration = 0;
  for (const r of completed) {
    const key = str(r[groupBy]) ?? "unknown";
    const d = runDurationMin(r);
    if (d === null) noDuration++;
    else groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  lines.push(`By ${groupBy}:`);
  // Largest group first; Map keeps insertion order for ties (stable sort).
  for (const [key, ds] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(
      `  ${key}: n=${String(ds.length)}, avg=${mean(ds).toFixed(1)}m, median=${median(ds).toFixed(1)}m, stdev=${stdev(ds).toFixed(1)}m`,
    );
  }
  if (noDuration > 0) lines.push(`  (skipped ${String(noDuration)} runs with missing timestamps)`);
  lines.push("");

  const all = [...groups.values()].flat().sort((a, b) => a - b);
  const n = all.length;
  if (n === 0) return lines.join("\n") + "\n";
  const at = (i: number): number => all[i] ?? 0;
  const p99 = n >= 100 ? at(Math.floor(n * 0.99)) : at(n - 1);
  lines.push(
    "Duration percentiles (all conclusions):",
    `  p50=${at(n >> 1).toFixed(1)}m  p90=${at(Math.floor(n * 0.9)).toFixed(1)}m  p99=${p99.toFixed(1)}m  max=${at(n - 1).toFixed(1)}m`,
    "",
    "Duration buckets:",
  );
  for (const [label, lo, hi] of BUCKETS) {
    const count = all.filter((d) => d >= lo && d < hi).length;
    const pct = (count / n) * 100;
    lines.push(
      `  ${label.padEnd(8)}: ${String(count).padStart(4)} (${pct.toFixed(1).padStart(4)}%) ${"█".repeat(Math.floor(pct / 2))}`,
    );
  }
  return lines.join("\n") + "\n";
};

export const main = (argv: string[], io: Io = defaultIo): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "group-by": { type: "string", default: "conclusion" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help === true) {
    io.out(USAGE);
    return 0;
  }
  const groupBy = parsed.values["group-by"];
  if ((groupBy !== "conclusion" && groupBy !== "event") || parsed.positionals.length > 1) {
    io.err(USAGE);
    return 2;
  }
  try {
    io.out(analyzeRuns(readJson(io, parsed.positionals[0]), groupBy));
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
