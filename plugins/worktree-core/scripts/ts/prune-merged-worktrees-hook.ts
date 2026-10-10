// SessionStart hook: remove Claude worktrees whose PR has merged.
//
// Mode: WORKTREE_AUTO_PRUNE env var (0/false/no/off = nudge only, 1/true/yes/on
// = auto-remove), then worktree.autoPrune (true/false) in settings, else print
// a one-line nudge if merged worktrees exist (--hint). See prune-merged-worktrees.ts for the safety envelope.
// Informational: always exits 0, even on internal failure.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  isRemote,
  resolveEnableMode,
  runHook,
  worktreeSetting,
  type HookCtx,
} from "./worktree-hook-lib.ts";

const PRUNE = join(import.meta.dirname, "prune-merged-worktrees.ts");

/** A JSON boolean becomes "on"/"off"; absent or any other value is "unset". */
const boolSetting = (settings: unknown): string => {
  const v = worktreeSetting(settings, "autoPrune");
  if (v === true) return "on";
  if (v === false) return "off";
  return "unset";
};

export const pruneMerged = (ctx: HookCtx, script: string = PRUNE): number => {
  if (isRemote(ctx.env)) return 0;
  // Fallback "" means "not configured": run the cheap --hint nudge. An
  // explicit "off" runs the full nudge-only (--hook) mode.
  const mode = resolveEnableMode(ctx, {
    envVar: "WORKTREE_AUTO_PRUNE",
    fromSettings: boolSetting,
    fallback: "",
    valid: ["on", "off"],
  });
  if (!existsSync(script)) return 0;
  const flag = mode === "on" ? "--auto" : mode === "off" ? "--hook" : "--hint";
  const r = ctx.script(script, [flag]);
  ctx.out(r.stdout);
  return 0;
};

if (import.meta.main) runHook("informational", (ctx) => pruneMerged(ctx));
