// Fetch run counts and timing stats for one or more workflow IDs in a repo.
//
// Usage: node fetch-workflow-stats.ts <owner/repo> <workflow_id> [workflow_id ...]
// Example: node fetch-workflow-stats.ts vitejs/vite 6990137 321928489
//
// Output: a table, one line per workflow: id | name | runs (30d) | avg_min | p90_min.
// A failing `gh` call degrades that cell ("unknown" name, "?" otherwise) instead of
// aborting, so one bad workflow ID doesn't hide the rest.
import { computeWorkflowTiming } from "./compute-workflow-timing.ts";
import { defaultIo, thirtyDaysAgo, type Io } from "./common.ts";
import { realGh, type Gh } from "./gh.ts";

const ROW = (id: string, name: string, runs: string, avg: string, p90: string): string =>
  `${id.padEnd(12)}  ${name.padEnd(40)}  ${runs.padStart(8)}  ${avg.padStart(8)}  ${p90.padStart(8)}`;

const attempt = (gh: Gh, args: string[], fallback: string): string => {
  try {
    return gh(args).trim();
  } catch {
    return fallback;
  }
};

export const fetchWorkflowStats = (
  repo: string,
  ids: readonly string[],
  gh: Gh,
  now: Date = new Date(),
): string => {
  const since = thirtyDaysAgo(now);
  const lines = [ROW("WF_ID", "NAME", "RUNS_30D", "AVG_MIN", "P90_MIN"), "-".repeat(92)];
  for (const id of ids) {
    const base = `repos/${repo}/actions/workflows/${id}`;
    const name = attempt(gh, [base, "--jq", ".name"], "unknown");
    const count = attempt(gh, [`${base}/runs?per_page=1&created=>=${since}`, "--jq", ".total_count"], "?");
    const runsJson = attempt(
      gh,
      [
        `${base}/runs?per_page=100`,
        "--jq",
        "[.workflow_runs[] | select(.conclusion != null) | {s: .run_started_at, e: .updated_at}]",
      ],
      "",
    );
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(runsJson);
    } catch {
      // Unparseable or empty output is "no data".
    }
    const [avg = "?", p90 = "?"] = computeWorkflowTiming(parsed).split(/\s+/);
    lines.push(ROW(id, name.slice(0, 40), count, avg, p90));
  }
  return lines.join("\n") + "\n";
};

export const main = (argv: string[], io: Io = defaultIo, gh: Gh = realGh, now: Date = new Date()): number => {
  const [repo, ...ids] = argv;
  if (repo === undefined) {
    io.err("Usage: fetch-workflow-stats.ts <owner/repo> <wf_id> [wf_id ...]\n");
    return 1;
  }
  if (ids.length === 0) {
    io.err("Error: provide at least one workflow ID\n");
    return 1;
  }
  io.out(fetchWorkflowStats(repo, ids, gh, now));
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
