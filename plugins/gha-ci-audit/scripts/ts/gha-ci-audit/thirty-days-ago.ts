// Print the UTC timestamp 30 days ago in the format the GitHub runs API's
// `created>=` filter expects (e.g. 2024-01-15T00:00:00Z).
//
// Usage: gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=1&created=>=$(node thirty-days-ago.ts)" --jq '.total_count'
import { defaultIo, thirtyDaysAgo, type Io } from "./common.ts";

export const main = (_argv: string[], io: Io = defaultIo, now: Date = new Date()): number => {
  io.out(thirtyDaysAgo(now) + "\n");
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
