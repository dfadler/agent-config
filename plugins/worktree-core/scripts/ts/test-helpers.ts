// Hermetic fixtures for the worktree-core script tests: a throwaway origin +
// clone under a temp dir, and a fixture-driven `gh` shim put first on PATH
// (the equivalent of the old bats PATH shims). Nothing touches the network or
// the developer's real repos.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRun } from "./proc.ts";

const GH_SHIM = `#!/bin/sh
case "$1" in
  --version) exit 0 ;;
  auth) exit "\${GH_AUTH_EXIT:-0}" ;;
  pr) [ -n "\${GH_LIST_EXIT:-}" ] && exit "$GH_LIST_EXIT"; cat "$GH_MERGED_FILE" ;;
esac
`;

export interface Sandbox {
  readonly root: string;
  /** The main checkout. */
  readonly repo: string;
  readonly env: Record<string, string>;
  readonly git: (cwd: string, ...args: string[]) => string;
  /** Create a pushed worktree under .claude/worktrees/<name>; returns its path. */
  readonly addWorktree: (name: string, branch?: string) => string;
  /** Record the worktree's current HEAD as a merged PR for `branch`. */
  readonly markMerged: (branch: string, oid: string) => void;
  readonly head: (cwd: string) => string;
  readonly cleanup: () => void;
}

export const makeSandbox = (): Sandbox => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wt-sandbox-")));
  const shim = join(root, "shim");
  mkdirSync(shim);
  writeFileSync(join(shim, "gh"), GH_SHIM);
  chmodSync(join(shim, "gh"), 0o755);
  const mergedFile = join(root, "merged.json");
  const merged: { headRefName: string; headRefOid: string }[] = [];
  const flush = (): void => {
    writeFileSync(mergedFile, JSON.stringify(merged));
  };
  flush();

  const env: Record<string, string> = {
    PATH: `${shim}:${process.env["PATH"] ?? ""}`,
    HOME: root,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
    GH_MERGED_FILE: mergedFile,
  };
  const run = makeRun(env);
  const git = (cwd: string, ...args: string[]): string => {
    const r = run("git", args, cwd);
    if (r.status !== 0)
      throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };

  const origin = join(root, "origin.git");
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "commit", "-q", "--allow-empty", "-m", "init");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "-u", "origin", "main");

  return {
    root,
    repo,
    env,
    git,
    addWorktree: (name, branch = `worktree-${name}`) => {
      const path = join(repo, ".claude", "worktrees", name);
      git(repo, "worktree", "add", "-q", "-b", branch, path);
      git(path, "push", "-q", "-u", "origin", branch);
      return path;
    },
    markMerged: (headRefName, headRefOid) => {
      merged.push({ headRefName, headRefOid });
      flush();
    },
    head: (cwd) => git(cwd, "rev-parse", "HEAD"),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
};

/** Write a file (creating parent dirs). */
export const put = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
