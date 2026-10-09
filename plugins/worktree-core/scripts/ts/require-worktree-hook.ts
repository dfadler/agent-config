// PreToolUse hook: block/warn/allow Edit and Write based on whether the cwd is
// the main git checkout rather than a linked worktree. Off by default.
//
// Mode (highest priority first): WORKTREE_ENFORCE env var (0/false/no/off,
// warn, block), then worktree.enforce in .claude/settings.json, then off.
// Skipped in cloud/remote sessions. A guard: an internal failure exits 2.
import {
  EXIT_BLOCK,
  isRemote,
  resolveEnableMode,
  runHook,
  stringSetting,
  type HookCtx,
} from "./worktree-hook-lib.ts";

export const requireWorktree = (ctx: HookCtx): number => {
  if (isRemote(ctx.env)) return 0;
  const gd = ctx.git(["rev-parse", "--git-dir"]);
  // Not a git repo (or no git): nothing to guard.
  if (gd.status !== 0) return 0;
  // In a linked worktree the git-dir is .git/worktrees/<name>.
  if (gd.stdout.includes(".git/worktrees/")) return 0;

  const mode = resolveEnableMode(ctx, {
    envVar: "WORKTREE_ENFORCE",
    fromSettings: stringSetting("enforce"),
    fallback: "off",
    valid: ["off", "warn", "block"],
  });
  if (mode === "warn") {
    ctx.out(
      "Warning: modifying files in the main git checkout.\n" +
        "Consider using EnterWorktree for isolated work.\n",
    );
    return 0;
  }
  if (mode === "off") return 0;
  ctx.err(
    "Cannot modify files in the main git checkout.\n" +
      "Use the EnterWorktree tool to create a linked worktree first,\n" +
      'or set worktree.enforce in .claude/settings.json to "warn" or "off".\n',
  );
  return EXIT_BLOCK;
};

if (import.meta.main) runHook("guard", requireWorktree);
