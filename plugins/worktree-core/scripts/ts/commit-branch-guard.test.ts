import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitBranchGuard, isGitCommit } from "./commit-branch-guard-hook.ts";
import type { Env, HookCtx } from "./worktree-hook-lib.ts";

const bash = (command: string, tool = "Bash"): string =>
  JSON.stringify({ tool_name: tool, tool_input: { command } });

interface Repo {
  gitDir?: string | undefined; // undefined = not a git repo
  branch?: string; // "" = detached HEAD
  ahead?: string; // rev-list --count default..HEAD
  symref?: string; // origin/HEAD target, e.g. "origin/main"
  local?: readonly string[]; // local branches that exist
  env?: Env;
  settings?: string;
}

const makeCtx = (r: Repo) => {
  const out: string[] = [];
  const ctx: HookCtx = {
    env: r.env ?? {},
    git: (args) => {
      const [a, b] = args;
      if (b === "--git-dir")
        return r.gitDir === undefined
          ? { status: 128, stdout: "" }
          : { status: 0, stdout: `${r.gitDir}\n` };
      if (b === "--show-toplevel") return { status: 0, stdout: "/top\n" };
      if (a === "branch") return { status: 0, stdout: `${r.branch ?? "main"}\n` };
      if (a === "symbolic-ref")
        return r.symref === undefined
          ? { status: 1, stdout: "" }
          : { status: 0, stdout: `${r.symref}\n` };
      if (a === "rev-parse" && b === "--verify")
        return { status: (r.local ?? ["main"]).includes(String(args[3]).replace("refs/heads/", "")) ? 0 : 1, stdout: "" };
      if (a === "rev-list") return { status: 0, stdout: `${r.ahead ?? "0"}\n` };
      return { status: 1, stdout: "" };
    },
    readFile: (p) => {
      if (p === "/top/.claude/settings.json" && r.settings !== undefined)
        return r.settings;
      throw new Error("ENOENT");
    },
    out: (t) => out.push(t),
    err: () => {},
    script: () => ({ stdout: "", stderr: "" }),
  };
  return { ctx, out };
};

const asks = (out: readonly string[]): boolean => {
  const v: unknown = JSON.parse(out.join(""));
  return (
    typeof v === "object" &&
    v !== null &&
    JSON.stringify(v).includes('"permissionDecision":"ask"')
  );
};

describe("isGitCommit", () => {
  it.each([
    "git commit -m x",
    "git add . && git commit -m x",
    "cd sub; git commit",
    "git -C /p commit -m x",
    "git -c user.name=a commit -m x",
    "rtk git commit -m x",
    "(git commit -m x)",
  ])("matches %s", (c) => {
    expect(isGitCommit(c)).toBe(true);
  });

  it.each([
    "git status",
    "git log --grep commit",
    "git commit-tree abc",
    "echo git commit",
    "gh pr create --title 'git commit'",
    "git push origin main",
  ])("ignores %s", (c) => {
    expect(isGitCommit(c)).toBe(false);
  });
});

describe("commitBranchGuard", () => {
  it("asks on the default branch in the main checkout", () => {
    const c = makeCtx({ gitDir: ".git", branch: "main" });
    expect(commitBranchGuard(c.ctx, bash("git commit -m x"))).toBe(0);
    expect(asks(c.out)).toBe(true);
    expect(c.out.join("")).toMatch(/default branch/);
  });

  it("asks on the default branch even in a linked worktree", () => {
    const c = makeCtx({ gitDir: "/p/.git/worktrees/w", branch: "main" });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(asks(c.out)).toBe(true);
  });

  it("asks in the main checkout on a branch already ahead of the default", () => {
    const c = makeCtx({ gitDir: ".git", branch: "setup-agent-skills", ahead: "3" });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(asks(c.out)).toBe(true);
    expect(c.out.join("")).toMatch(/setup-agent-skills/);
  });

  it("stays quiet in the main checkout on a fresh branch (nothing ahead)", () => {
    const c = makeCtx({ gitDir: ".git", branch: "my-fix", ahead: "0" });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(c.out).toEqual([]);
  });

  it("stays quiet in a linked worktree on its own branch, even when ahead", () => {
    const c = makeCtx({ gitDir: "/p/.git/worktrees/w", branch: "claude/w", ahead: "5" });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(c.out).toEqual([]);
  });

  it("stays quiet on a detached HEAD", () => {
    const c = makeCtx({ gitDir: ".git", branch: "", ahead: "2" });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(c.out).toEqual([]);
  });

  it("uses origin/HEAD for the default name, so trunk-named branches work", () => {
    const c = makeCtx({
      gitDir: ".git",
      branch: "trunk",
      symref: "origin/trunk",
      local: ["trunk"],
    });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(asks(c.out)).toBe(true);
  });

  it("falls back to master when there is no main", () => {
    const c = makeCtx({ gitDir: ".git", branch: "master", local: ["master"] });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(asks(c.out)).toBe(true);
  });

  it("skips the ahead check when no default branch can be found", () => {
    const c = makeCtx({ gitDir: ".git", branch: "x", ahead: "9", local: [] });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(c.out).toEqual([]);
  });

  it.each<[string, string, Repo]>([
    ["a non-Bash tool", bash("git commit -m x", "Edit"), {}],
    ["a non-commit command", bash("git status"), {}],
    ["malformed stdin", "{nope", {}],
    ["empty stdin", "", {}],
    ["no command", JSON.stringify({ tool_name: "Bash", tool_input: {} }), {}],
    ["a remote session", bash("git commit -m x"), { env: { CLAUDE_CODE_REMOTE: "true" } }],
    ["outside a git repo", bash("git commit -m x"), { gitDir: undefined }],
    ["env off", bash("git commit -m x"), { env: { WORKTREE_COMMIT_GUARD: "off" } }],
    ["settings off", bash("git commit -m x"), { settings: JSON.stringify({ worktree: { commitGuard: "off" } }) }],
  ])("stays quiet for %s", (_n, stdin, r) => {
    const c = makeCtx({ gitDir: ".git", branch: "main", ...r });
    expect(commitBranchGuard(c.ctx, stdin)).toBe(0);
    expect(c.out).toEqual([]);
  });

  it("env ask beats settings off", () => {
    const c = makeCtx({
      gitDir: ".git",
      branch: "main",
      env: { WORKTREE_COMMIT_GUARD: "ask" },
      settings: JSON.stringify({ worktree: { commitGuard: "off" } }),
    });
    commitBranchGuard(c.ctx, bash("git commit -m x"));
    expect(asks(c.out)).toBe(true);
  });
});

// End to end: the real entrypoint, spawned the way hooks.json spawns it.
describe("commit-branch-guard-hook (spawned)", () => {
  let tmp: string;
  let main: string;
  let linked: string;
  const git = (cwd: string, ...a: string[]) =>
    spawnSync("git", a, { cwd, encoding: "utf8" });
  const commit = (cwd: string) =>
    git(cwd, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c");
  const hook = (cwd: string, command: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [join(import.meta.dirname, "commit-branch-guard-hook.ts")], {
      cwd: tmp,
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }),
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: tmp, ...env },
    });

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wt-cbg-"));
    main = join(tmp, "main");
    linked = join(tmp, "linked");
    mkdirSync(main);
    git(main, "init", "-q", "-b", "main");
    commit(main);
    git(main, "worktree", "add", "-q", "-b", "feat", linked);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("asks (exit 0 + ask JSON) when committing on main in the main checkout", () => {
    const r = hook(main, "git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/"permissionDecision":"ask"/);
  });

  it("is silent in the linked worktree on its branch, judged by the stdin cwd", () => {
    commit(linked);
    const r = hook(linked, "git commit -m x");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("asks in the main checkout on a branch with someone else's commits", () => {
    git(main, "switch", "-q", "-c", "other");
    commit(main);
    expect(hook(main, "git commit -m x").stdout).toMatch(/other/);
  });

  it("is silent on a fresh branch and on detached HEAD", () => {
    git(main, "switch", "-q", "-c", "fresh");
    expect(hook(main, "git commit -m x").stdout).toBe("");
    git(main, "switch", "-q", "--detach");
    commit(main);
    expect(hook(main, "git commit -m x").stdout).toBe("");
  });

  it("honours worktree.commitGuard in the repo's settings.json", () => {
    mkdirSync(join(main, ".claude"));
    writeFileSync(join(main, ".claude", "settings.json"), JSON.stringify({ worktree: { commitGuard: "off" } }));
    expect(hook(main, "git commit -m x").stdout).toBe("");
  });

  it("fails open on garbage stdin", () => {
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "commit-branch-guard-hook.ts")], {
      cwd: main,
      input: "{nope",
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", HOME: tmp },
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
