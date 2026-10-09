// SessionStart hook: run verify-worktree-symlinks.sh --fix and surface its
// output. Off by default (WORKTREE_SYMLINK_CHECK=on or worktree.symlinkCheck
// "on"). Informational: always exits 0, even on internal failure.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isRemote,
  resolveEnableMode,
  runHook,
  stringSetting,
  type HookCtx,
} from "./worktree-hook-lib.ts";

const VERIFY = join(
  import.meta.dirname,
  "..",
  "..",
  "skills",
  "git-worktree-usage",
  "scripts",
  "verify-worktree-symlinks.sh",
);

export const checkSymlinks = (ctx: HookCtx, script: string = VERIFY): number => {
  if (isRemote(ctx.env)) return 0;
  const mode = resolveEnableMode(ctx, {
    envVar: "WORKTREE_SYMLINK_CHECK",
    fromSettings: stringSetting("symlinkCheck"),
    fallback: "off",
    valid: ["on", "off"],
  });
  if (mode !== "on" || !existsSync(script)) return 0;
  const r = ctx.bash(script, ["--fix"]);
  const output = (r.stdout + r.stderr).trim();
  if (output !== "") ctx.out(`🔗 ${output}\n`);
  return 0;
};

if (import.meta.main) runHook("informational", (ctx) => checkSymlinks(ctx));
