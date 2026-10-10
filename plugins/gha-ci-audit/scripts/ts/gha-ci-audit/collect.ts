// Collect all GitHub Actions data for one eval, in a single process.
//
// Usage: node collect.ts --repo <owner/repo> --output-dir <path> [--workflow-id <id>]
//
// Exit codes:
//   0  success, all output files written
//   1  fatal error (or bad usage)
//   2  ambiguous primary workflow: workflow_candidates.json written; the caller
//      must re-invoke with --workflow-id <id> after disambiguation
//
// Output files (names are a contract with agents/collector.md and renderer.md):
// workflows.json, run_count_primary.txt, runs.json, p50_run.txt, jobs.json,
// failure_check.json, workflow_stats.txt, collect_summary.json,
// collect_timing.json, and workflow_candidates.json on the ambiguous path.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { checkFailures, failureJson, formatFailureReport } from "./check-failures.ts";
import { defaultIo, fmt, isObject, str, thirtyDaysAgo, type Io, type Json } from "./common.ts";
import { fetchWorkflowStats } from "./fetch-workflow-stats.ts";
import { findP50Run } from "./find-p50-run.ts";
import { realGh, type Gh } from "./gh.ts";
import { end, start } from "./timing.ts";

export class CollectFatalError extends Error {}

const parseJson = (name: string, raw: string, empty: unknown): unknown => {
  if (raw.trim() === "") return empty;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new CollectFatalError(`Invalid JSON in ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
};

/** `workflow_candidates.json` has already been written when this is thrown. */
export class AmbiguousPrimaryWorkflowError extends Error {}

export interface PrimaryWorkflowResult {
  readonly workflow: Json | null;
  readonly candidates: readonly Json[];
  readonly ambiguous: boolean;
  readonly warning: string | null;
}

/** The distinct event types seen in a workflow's last 10 runs; empty on any error. */
export const getWorkflowEvents = (repo: string, workflowId: number, gh: Gh): Set<string> => {
  try {
    const events: unknown = JSON.parse(
      gh([`repos/${repo}/actions/workflows/${String(workflowId)}/runs?per_page=10`, "--jq", "[.workflow_runs[].event] | unique"]).trim() ||
        "[]",
    );
    return new Set(Array.isArray(events) ? events.filter((e): e is string => typeof e === "string") : []);
  } catch {
    return new Set();
  }
};

/** Primary = triggered by push or pull_request, judged from each workflow's recent runs. */
export const detectPrimaryWorkflow = (workflows: readonly Json[], repo: string, gh: Gh): PrimaryWorkflowResult => {
  const candidates = workflows.filter((wf) => {
    const events = getWorkflowEvents(repo, Number(wf["id"]), gh);
    return events.has("push") || events.has("pull_request");
  });
  const [only] = candidates;
  if (only !== undefined && candidates.length === 1) {
    return { workflow: only, candidates: [], ambiguous: false, warning: null };
  }
  if (candidates.length > 1) return { workflow: null, candidates, ambiguous: true, warning: null };
  const [first] = workflows;
  if (first !== undefined) {
    return {
      workflow: first,
      candidates: [],
      ambiguous: false,
      warning:
        "Warning: no push/pull_request triggers found; " +
        `defaulting to first active workflow: ${str(first["name"]) ?? "unknown"} (id=${String(first["id"])})`,
    };
  }
  return { workflow: null, candidates: [], ambiguous: false, warning: "No active workflows found." };
};

export const buildCollectSummary = (a: {
  repo: string;
  workflowId: number;
  workflowName: string;
  p50RunId: number;
  p50DurationMin: number;
  runCount: number;
  now: Date;
}): Record<string, string | number> => ({
  repo: a.repo,
  primary_workflow_id: a.workflowId,
  primary_workflow_name: a.workflowName,
  p50_run_id: a.p50RunId,
  p50_duration_min: a.p50DurationMin,
  run_count_30d: a.runCount,
  collected_at: a.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
});

export interface CollectDeps {
  readonly gh: Gh;
  readonly now: () => Date;
  /** Progress/diagnostics (stderr). */
  readonly log: (s: string) => void;
}

export interface CollectResult {
  readonly repo: string;
  readonly workflowId: number;
  readonly workflowName: string;
  readonly p50RunId: number;
  readonly runCount: number;
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

/** `gh api`, with a failure surfaced as the fatal error the CLI maps to exit 1. */
const api = (gh: Gh, args: string[]): string => {
  try {
    return gh(args);
  } catch (e) {
    throw new CollectFatalError(e instanceof Error ? e.message : String(e));
  }
};

/** One full collect iteration. Throws `AmbiguousPrimaryWorkflowError` or `CollectFatalError`. */
export const collect = (a: {
  repo: string;
  outputDir: string;
  workflowId: number | null;
  deps: CollectDeps;
}): CollectResult => {
  const { repo, outputDir, deps } = a;
  const { gh, log } = deps;
  mkdirSync(outputDir, { recursive: true });
  const marker = start(deps.now());
  const write = (name: string, text: string): void => {
    writeFileSync(join(outputDir, name), text);
  };

  log(`[collect] Step 1: fetching workflow list for ${repo}\n`);
  const workflowsRaw = api(gh, [
    `repos/${repo}/actions/workflows`,
    "--jq",
    '[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)',
  ]);
  write("workflows.json", workflowsRaw);
  const parsedWorkflows: unknown = parseJson("workflows", workflowsRaw, []);
  const workflows = Array.isArray(parsedWorkflows) ? parsedWorkflows.filter(isObject) : [];

  let workflowId = a.workflowId;
  if (workflowId === null) {
    log("[collect] Detecting primary CI workflow\n");
    const detection = detectPrimaryWorkflow(workflows, repo, gh);
    if (detection.ambiguous) {
      const candidatesPath = join(outputDir, "workflow_candidates.json");
      write("workflow_candidates.json", json(detection.candidates));
      const names = detection.candidates.map((w) => str(w["name"]) ?? "unknown");
      log("[collect] AMBIGUOUS: multiple primary workflow candidates found.\n");
      log(`[collect] See ${candidatesPath}\n`);
      log(`Ambiguous: ${String(detection.candidates.length)} workflows match push/pull_request: ${JSON.stringify(names)}\n`);
      throw new AmbiguousPrimaryWorkflowError(`Ambiguous primary workflow; see ${candidatesPath}`);
    }
    if (detection.workflow === null) {
      const message = detection.warning ?? "No active workflows found.";
      log(message + "\n");
      throw new CollectFatalError(message);
    }
    if (detection.warning !== null) log(detection.warning + "\n");
    workflowId = Number(detection.workflow["id"]);
  }

  const primary = workflows.find((wf) => wf["id"] === workflowId);
  const workflowName = str(primary?.["name"]) ?? "unknown";
  log(`[collect] Primary workflow: ${workflowName} (id=${String(workflowId)})\n`);

  log("[collect] Step 2: fetching 30-day run count\n");
  const since = thirtyDaysAgo(deps.now());
  const runCountRaw = api(gh, [
    `repos/${repo}/actions/workflows/${String(workflowId)}/runs?per_page=1&created=>=${since}`,
    "--jq",
    ".total_count",
  ]);
  write("run_count_primary.txt", runCountRaw);
  const runCount = Number(runCountRaw.trim());
  if (!Number.isInteger(runCount)) throw new CollectFatalError(`unexpected run count: ${runCountRaw.trim()}`);

  log("[collect] Step 3: fetching workflow runs\n");
  const runsRaw = api(gh, [`repos/${repo}/actions/workflows/${String(workflowId)}/runs?per_page=100`]);
  write("runs.json", runsRaw);
  const runsPayload: unknown = parseJson("runs", runsRaw, {});

  log("[collect] Step 4: computing p50 run\n");
  const p50 = findP50Run(runsPayload);
  if (p50 === null) throw new CollectFatalError("No successful runs with duration data found.");
  write("p50_run.txt", `${String(p50.runId)}  ${fmt(p50.durationMin, 1)}m  ${p50.createdAt}\n`);
  log(`# p50=${fmt(p50.p50, 1)}m  n=${String(p50.n)} successful runs\n`);

  log(`[collect] Step 5: fetching jobs for p50 run ${String(p50.runId)}\n`);
  write("jobs.json", api(gh, [`repos/${repo}/actions/runs/${String(p50.runId)}/jobs?per_page=100`]));

  log("[collect] Step 6: checking for chronic failures\n");
  const failure = checkFailures(runsPayload);
  log(formatFailureReport(failure).join("\n") + "\n");
  write("failure_check.json", json(failureJson(failure)));

  log("[collect] Step 7: fetching secondary workflow stats\n");
  const secondary = workflows.filter((wf) => wf["id"] !== workflowId).map((wf) => String(wf["id"]));
  write(
    "workflow_stats.txt",
    secondary.length === 0 ? "no secondary workflows\n" : fetchWorkflowStats(repo, secondary, gh, deps.now()),
  );

  log("[collect] Step 8: writing collect_summary.json\n");
  write(
    "collect_summary.json",
    json(
      buildCollectSummary({
        repo,
        workflowId,
        workflowName,
        p50RunId: p50.runId,
        p50DurationMin: p50.durationMin,
        runCount,
        now: deps.now(),
      }),
    ),
  );

  write("collect_timing.json", json(end(marker, deps.now())));
  return { repo, workflowId, workflowName, p50RunId: p50.runId, runCount };
};

const USAGE = "Usage: collect.ts --repo <owner/repo> --output-dir <path> [--workflow-id <id>]\n";

/** Bad usage exits 1, not 2: exit 2 is reserved for "ambiguous primary workflow". */
export const main = (
  argv: string[],
  io: Io = defaultIo,
  deps: CollectDeps = { gh: realGh, now: () => new Date(), log: (s) => { io.err(s); } },
): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        repo: { type: "string" },
        "output-dir": { type: "string" },
        "workflow-id": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 1;
  }
  const { repo, "output-dir": outputDir, "workflow-id": idText, help } = parsed.values;
  if (help === true) {
    io.out(USAGE);
    return 0;
  }
  const workflowId = idText === undefined ? null : Number(idText);
  if (repo === undefined || repo === "" || outputDir === undefined || outputDir === "") {
    io.err(`--repo and --output-dir are required\n${USAGE}`);
    return 1;
  }
  if (workflowId !== null && !Number.isInteger(workflowId)) {
    io.err(`--workflow-id must be an integer\n${USAGE}`);
    return 1;
  }
  try {
    const r = collect({ repo, outputDir, workflowId, deps });
    io.out(
      `COLLECT OK: ${r.repo}  primary=${r.workflowName} id=${String(r.workflowId)}  p50_run=${String(r.p50RunId)}  runs_30d=${String(r.runCount)}\n`,
    );
    return 0;
  } catch (e) {
    if (e instanceof AmbiguousPrimaryWorkflowError) return 2;
    io.err(`${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
