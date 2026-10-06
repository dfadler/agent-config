import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/** Exit status of `git check-ignore -q`: the path is ignored. */
const GIT_IGNORED = 0;
/** Exit status of `git check-ignore -q`: the path is not ignored. */
const GIT_NOT_IGNORED = 1;

/**
 * Environment for the git call: the user's global and system git config, and
 * any `GIT_DIR`-style variable inherited from a hook, are removed. A global
 * excludes file would hide the very defect this rule reports (the repo's own
 * `.gitignore` not covering the results directory), because a fresh clone on
 * another machine does not have it.
 */
const isolatedGitEnv = (): NodeJS.ProcessEnv => {
  const kept = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("GIT_") && key !== "HOME" && key !== "XDG_CONFIG_HOME",
    ),
  );
  return {
    ...kept,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    HOME: "/nonexistent",
    XDG_CONFIG_HOME: "/nonexistent",
  };
};

/**
 * Whether git says `path` is ignored: true or false, or undefined when git
 * cannot tell (not installed, not a repository, path outside the work tree).
 */
const isIgnored = (cwd: string, path: string): boolean | undefined => {
  const result = spawnSync("git", ["check-ignore", "-q", "--", path], {
    cwd,
    env: isolatedGitEnv(),
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error !== undefined) return undefined;
  if (result.status === GIT_IGNORED) return true;
  if (result.status === GIT_NOT_IGNORED) return false;
  return undefined;
};

/**
 * EVAL015: the results directory must be gitignored. A run writes
 * `<eval dir>/results/<timestamp>/` (report.html, aggregate-result.json,
 * traces), so a repo that does not ignore it will commit run output.
 *
 * Repo level, so `checkSuite`. It asks `git check-ignore` about a file inside
 * the results directory, which is ignored whether the pattern names the
 * directory or its contents and works before any run has created it. It is a
 * no-op when the plugin is not in a git repository, git is missing, or the
 * eval directory does not exist.
 */
export const rule: Rule = {
  id: "EVAL015",
  severity: "warn",
  title: "Results directory is not covered by git check-ignore",
  source: fromDocs(
    "a run writes results/<timestamp>/ inside the eval directory; add results/ to .gitignore (repo defect fixed in #445)",
  ),
  checkSuite: ({ suite }) => {
    // Absolute, because git runs with this directory as its cwd.
    const evalDir = resolve(suite.evalDir);
    if (!existsSync(evalDir)) return [];
    const resultsDir = join(evalDir, "results");
    const probe = join(resultsDir, "probe", "aggregate-result.json");
    return isIgnored(evalDir, probe) === false
      ? [
          {
            message: `The results directory ${resultsDir} is not ignored by git, so run output (report.html, aggregate-result.json, traces) will show up as untracked files and may be committed.`,
            fix: "Add `**/evals/results/` (or the results path for your eval directory) to the repo's .gitignore, then confirm with `git check-ignore -v <eval dir>/results/x`. A global gitignore does not count: another clone will not have it.",
            loc: { file: resultsDir, line: 1 },
          },
        ]
      : [];
  },
};
