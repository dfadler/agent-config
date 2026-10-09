// Analyze GitHub Actions jobs for a workflow run: critical path, billable
// minutes, runner types, and optional name filtering.
//
// Usage:
//   gh api "repos/{owner}/{repo}/actions/runs/{run_id}/jobs?per_page=100" | node analyze-jobs.ts
//   node analyze-jobs.ts jobs.json [--filter SUBSTR] [--top N] [--steps]
import { parseArgs } from "node:util";
import {
  defaultIo,
  fmt,
  isObject,
  parseDt,
  readJson,
  spanMinutes,
  str,
  unwrapList,
  type Io,
  type Json,
} from "./common.ts";

const USAGE = `Usage: analyze-jobs.ts [file] [--filter SUBSTR] [--top N] [--steps]
Reads jobs JSON from file, or stdin when omitted.
`;

export const jobDurationMin = (j: Json): number | null =>
  spanMinutes(str(j["started_at"]), str(j["completed_at"]));

export const classifyRunner = (name: string): string => {
  if (name === "") return "unknown";
  if (/runs-on--i-|self-hosted/i.test(name)) return "self-hosted";
  if (/ubuntu-|macos-|windows-/i.test(name)) return "github-hosted";
  return "unknown";
};

interface Job {
  readonly raw: Json;
  readonly name: string;
  readonly dur: number | null;
}

export const analyzeJobs = (
  raw: unknown,
  opts: { filter?: string; top: number; steps: boolean },
): string => {
  const lines: string[] = [];
  let jobs = unwrapList(raw, "jobs");
  if (opts.filter !== undefined && opts.filter !== "") {
    const needle = opts.filter.toLowerCase();
    jobs = jobs.filter((j) => (str(j["name"]) ?? "").toLowerCase().includes(needle));
    lines.push(`Filtered to jobs matching "${opts.filter}": ${String(jobs.length)} jobs`, "");
  }

  const completed: Job[] = jobs
    .filter((j) => str(j["completed_at"]) !== null && j["completed_at"] !== "")
    .map((j) => ({ raw: j, name: str(j["name"]) ?? "", dur: jobDurationMin(j) }));
  if (completed.length === 0) return [...lines, "No completed jobs found."].join("\n") + "\n";

  const withDur = completed.filter((j) => j.dur !== null);
  const dur = (j: Job): number => j.dur ?? 0;

  // Critical path: jobs finishing within 30s of the pipeline end.
  const ends = completed.map((j) => parseDt(str(j.raw["completed_at"]))?.getTime() ?? null);
  const pipelineEnd = Math.max(...ends.filter((t): t is number => t !== null));
  const critical = completed.filter((_, i) => {
    const t = ends[i];
    return t !== null && t !== undefined && (pipelineEnd - t) / 1000 < 30;
  });

  const totalJobMin = withDur.reduce((a, j) => a + dur(j), 0);
  const wallClock = withDur.length > 0 ? Math.max(...withDur.map(dur)) : 0;

  lines.push(
    `Jobs in run:  ${String(completed.length)} completed`,
    `Wall-clock:   ${fmt(wallClock, 1)}m`,
    wallClock > 0
      ? `Total job-min (billable estimate): ${fmt(totalJobMin, 1)}m  (parallelism factor: ${fmt(totalJobMin / wallClock, 1)}x)`
      : "",
    "",
    `Critical path (${String(critical.length)} job(s) finishing last):`,
  );
  for (const j of [...critical].sort((a, b) => dur(b) - dur(a))) {
    const rt = classifyRunner(str(j.raw["runner_name"]) ?? "");
    const d = j.dur === null ? "?" : fmt(j.dur, 1);
    lines.push(`  [${rt}] ${j.name}: ${d}m  conclusion=${(str(j.raw["conclusion"]) ?? "None")}`);
  }
  lines.push("");

  const byRunner = new Map<string, number[]>();
  for (const j of withDur) {
    const rt = classifyRunner(str(j.raw["runner_name"]) ?? "");
    byRunner.set(rt, [...(byRunner.get(rt) ?? []), dur(j)]);
  }
  lines.push("Runner types:");
  for (const [rt, ds] of [...byRunner].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    lines.push(`  ${rt}: ${String(ds.length)} jobs, ${fmt(ds.reduce((a, b) => a + b, 0), 1)} job-min total`);
  }
  lines.push("");

  const top = [...withDur].sort((a, b) => dur(b) - dur(a)).slice(0, opts.top);
  lines.push(`Top ${String(Math.min(opts.top, top.length))} longest jobs:`);
  for (const j of top) {
    lines.push(`  ${fmt(dur(j), 1).padStart(6)}m  ${j.name}  ${critical.includes(j) ? "★ CRITICAL" : ""}`);
  }
  lines.push("");

  if (opts.steps) {
    for (const j of critical) {
      const steps = Array.isArray(j.raw["steps"]) ? j.raw["steps"].filter(isObject) : [];
      if (steps.length === 0) {
        lines.push(`No step data for: ${j.name}`);
        continue;
      }
      lines.push(`Steps for: ${j.name}`);
      for (const s of steps) {
        const sd = jobDurationMin(s);
        const d = sd === null ? "—" : `${fmt(sd, 1)}m`;
        lines.push(`  ${d.padEnd(6)}  ${(str(s["name"]) ?? "None")}  (${str(s["conclusion"]) ?? "?"})`);
      }
      lines.push("");
    }
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
        filter: { type: "string" },
        top: { type: "string", default: "10" },
        steps: { type: "boolean", default: false },
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
  const top = Number(parsed.values.top);
  if (!Number.isInteger(top) || top < 0 || parsed.positionals.length > 1) {
    io.err(USAGE);
    return 2;
  }
  try {
    io.out(
      analyzeJobs(readJson(io, parsed.positionals[0]), {
        ...(parsed.values.filter === undefined ? {} : { filter: parsed.values.filter }),
        top,
        steps: parsed.values.steps,
      }),
    );
    return 0;
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
