// Check a workflow's run history for chronic failure patterns: failure rate,
// the consecutive-failure streak at the head of the list, and the earliest
// run in that streak. Agents use it to decide whether to show an alert banner.
//
// Usage:
//   node check-failures.ts runs.json [--output failure_check.json]
//   gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | node check-failures.ts
//
// Downstream automation should read the --output JSON (`chronic`,
// `failure_rate`, `details`) rather than the exit code: a shell pipeline that
// redirects stdout to a file discards it. The exit code (0 healthy, 1 chronic)
// is a convenience for interactive use, e.g. `check-failures.ts runs.json || echo alert`.
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { defaultIo, fmt, readJson, str, unwrapList, type Io } from "./common.ts";

export interface FailureCheck {
  readonly chronic: boolean;
  readonly failureRate: number;
  readonly details: string;
  readonly noData: boolean;
  readonly streak: number;
  readonly failures: number;
  readonly completed: number;
  readonly earliestInStreak: string;
}

/** `raw` is a runs API response (`{workflow_runs: [...]}`) or a bare list of runs. */
export const checkFailures = (raw: unknown): FailureCheck => {
  const completed = unwrapList(raw, "workflow_runs").flatMap((r) => {
    const c = str(r["conclusion"]);
    return c === null || c === "" || c === "skipped" ? [] : [{ c, created: str(r["created_at"]) ?? "" }];
  });
  if (completed.length === 0) {
    return {
      chronic: false,
      failureRate: 0,
      details: "no_data",
      noData: true,
      streak: 0,
      failures: 0,
      completed: 0,
      earliestInStreak: "",
    };
  }
  const failures = completed.filter((r) => r.c === "failure").length;
  const rate = failures / completed.length;
  const firstOk = completed.findIndex((r) => r.c !== "failure");
  const streak = firstOk === -1 ? completed.length : firstOk;
  const stamps = completed
    .slice(0, streak)
    .map((r) => r.created)
    .filter((t) => t !== "");
  const earliest = stamps.length === 0 ? "" : stamps.reduce((a, b) => (b < a ? b : a));
  return {
    chronic: rate > 0.4 || streak >= 5,
    failureRate: Number(fmt(rate, 2)),
    details:
      `failure_rate=${fmt(rate, 2)} failures=${String(failures)}/${String(completed.length)} ` +
      `consecutive_streak=${String(streak)} earliest_in_streak=${earliest === "" ? "n/a" : earliest}`,
    noData: false,
    streak,
    failures,
    completed: completed.length,
    earliestInStreak: earliest,
  };
};

/** The human-readable lines the CLI prints. */
export const formatFailureReport = (fc: FailureCheck): string[] =>
  fc.noData
    ? ["no_data"]
    : [
        `failure_rate=${fmt(fc.failureRate, 2)}  failures=${String(fc.failures)}/${String(fc.completed)}`,
        `consecutive_streak=${String(fc.streak)}  earliest_in_streak=${fc.earliestInStreak}`,
        `chronic=${fc.chronic ? "YES" : "no"}`,
      ];

/** The machine-readable shape written to failure_check.json. */
export const failureJson = (fc: FailureCheck): { chronic: boolean; failure_rate: number; details: string } => ({
  chronic: fc.chronic,
  failure_rate: fc.failureRate,
  details: fc.details,
});

const USAGE = "Usage: check-failures.ts [runs.json] [--output failure_check.json]\n";

export const main = (argv: string[], io: Io = defaultIo): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { output: { type: "string" }, help: { type: "boolean", short: "h" } },
    });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help === true) {
    io.out(USAGE);
    return 0;
  }
  if (parsed.positionals.length > 1) {
    io.err(USAGE);
    return 2;
  }
  let result: FailureCheck;
  try {
    result = checkFailures(readJson(io, parsed.positionals[0]));
  } catch (e) {
    io.err(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
  io.out(formatFailureReport(result).join("\n") + "\n");
  if (parsed.values.output !== undefined) {
    writeFileSync(parsed.values.output, JSON.stringify(failureJson(result), null, 2) + "\n");
  }
  return result.chronic ? 1 : 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
