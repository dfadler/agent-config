// PreToolUse (Bash) hook: ask before `git commit` lands on a branch that is
// probably not this session's own (#951). It asks, never blocks, and stays
// silent on the normal path: a linked worktree on its own branch.
//
// It asks when, in the cwd from the hook's stdin JSON:
//   - the checked-out branch is the default branch (any checkout), or
//   - the checkout is the main one (not a linked worktree) and the branch is
//     already ahead of the default branch (it holds commits this session did
//     not make, or is about to hold a second one).
// Detached HEAD is never flagged (rebase, bisect, cherry-pick land there).
// A fresh branch in the main checkout (nothing ahead yet) is not flagged either,
// so `git switch -c fix` then commit passes the first time.
//
// ponytail: "ahead of default" cannot tell this session's own earlier commits
// from someone else's, so a session that cut a branch in the main checkout and
// commits twice gets asked on the second; it is only a prompt. Upgrade path:
// record the branch tip per session if that proves noisy.
//
// Mode (highest priority first): WORKTREE_COMMIT_GUARD env var (ask, off), then
// worktree.commitGuard in .claude/settings.json, then ask. Skipped in
// cloud/remote sessions. Informational: an internal failure exits 0.
// Output shape: https://code.claude.com/docs/en/hooks (PreToolUse decision control)
import {
  isRemote,
  resolveEnableMode,
  runHook,
  stringSetting,
  type HookCtx,
} from "./worktree-hook-lib.ts";

// `git [-C dir|-c k=v]... commit` at the start of a command or after ; & | (,
// optionally behind rtk (the output-condensing wrapper the user may run).
const GIT_COMMIT =
  /(?:^|[;&|(]\s*)(?:rtk\s+)?git(?:\s+-[cC]\s+\S+)*\s+commit(?![\w-])/;

export const isGitCommit = (command: string): boolean =>
  GIT_COMMIT.test(command.trim());

const commandOf = (stdin: string): string | undefined => {
  try {
    const v: unknown = JSON.parse(stdin);
    if (typeof v !== "object" || v === null) return undefined;
    const rec = Object.fromEntries(Object.entries(v));
    if (rec["tool_name"] !== "Bash") return undefined;
    const input: unknown = rec["tool_input"];
    if (typeof input !== "object" || input === null) return undefined;
    const cmd: unknown = Object.fromEntries(Object.entries(input))["command"];
    return typeof cmd === "string" ? cmd : undefined;
  } catch {
    return undefined;
  }
};

/** Name of the default branch, or undefined when no candidate exists locally. */
const defaultBranch = (ctx: HookCtx): string | undefined => {
  const sym = ctx.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  const fromRemote =
    sym.status === 0 ? sym.stdout.trim().replace(/^origin\//, "") : "";
  return [fromRemote, "main", "master"].find(
    (b) =>
      b !== "" &&
      ctx.git(["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]).status === 0,
  );
};

export const commitBranchGuard = (ctx: HookCtx, stdin: string): number => {
  if (isRemote(ctx.env)) return 0;
  const command = commandOf(stdin);
  if (command === undefined || !isGitCommit(command)) return 0;
  const mode = resolveEnableMode(ctx, {
    envVar: "WORKTREE_COMMIT_GUARD",
    fromSettings: stringSetting("commitGuard"),
    fallback: "ask",
    valid: ["ask", "off"],
  });
  if (mode === "off") return 0;

  const gd = ctx.git(["rev-parse", "--git-dir"]);
  if (gd.status !== 0) return 0;
  const branch = ctx.git(["branch", "--show-current"]).stdout.trim();
  if (branch === "") return 0; // detached HEAD
  const linked = gd.stdout.includes(".git/worktrees/");
  const def = defaultBranch(ctx);
  if (def === undefined) return 0;

  const onDefault = branch === def;
  const ahead = onDefault || linked
    ? 0
    : Number(ctx.git(["rev-list", "--count", `${def}..HEAD`]).stdout.trim());
  const reason = onDefault
    ? `This commit would land on the default branch '${branch}'. Use EnterWorktree (or git switch -c) to start a branch for this task first, unless you mean to commit here.`
    : ahead > 0
      ? `This commit would land on '${branch}' in the main checkout, which is ${String(ahead)} commit(s) ahead of '${def}' with work this session may not own. Confirm this is the branch for the task, or use EnterWorktree to start a clean one.`
      : undefined;
  if (reason === undefined) return 0;
  ctx.out(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
  return 0;
};

if (import.meta.main) runHook("informational", commitBranchGuard);
