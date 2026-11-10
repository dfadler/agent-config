// PreToolUse hook: block/warn/allow Edit and Write based on whether the cwd is
// the main git checkout rather than a linked worktree. Off by default. "The cwd"
// is the one in the hook's stdin JSON (it follows the session into a worktree),
// else the process directory (worktree-hook-lib.ts, payloadCwd).
//
// Mode (highest priority first): WORKTREE_ENFORCE env var (0/false/no/off,
// warn, block), then worktree.enforce in .claude/settings.json, then off.
// Skipped in cloud/remote sessions. A guard: an internal failure exits 2.
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  EXIT_BLOCK,
  isRemote,
  resolveEnableMode,
  runHook,
  stringSetting,
  type HookCtx,
} from "./worktree-hook-lib.ts";

/** realpath of the nearest existing ancestor plus the not-yet-existing tail. */
const resolveLoose = (p: string): string => {
  const tail: string[] = [];
  let cur = resolve(p);
  for (;;) {
    try {
      return join(realpathSync(cur), ...tail.reverse());
    } catch {
      const up = dirname(cur);
      if (up === cur) return resolve(p);
      tail.push(basename(cur));
      cur = up;
    }
  }
};

/**
 * True only when the payload names a `tool_input.file_path` that resolves
 * (symlinks and `..` followed) outside the repo's work tree. A missing or
 * unparsable path returns false, so the guard keeps blocking (fail closed).
 */
const targetsOutsideRepo = (ctx: HookCtx, stdin: string): boolean => {
  let fp: unknown;
  try {
    const v: unknown = JSON.parse(stdin);
    const input = typeof v === "object" && v !== null && "tool_input" in v ? v.tool_input : undefined;
    fp = typeof input === "object" && input !== null && "file_path" in input ? input.file_path : undefined;
  } catch {
    return false;
  }
  if (typeof fp !== "string" || !isAbsolute(fp)) return false;
  const top = ctx.git(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || top.stdout.trim() === "") return false;
  const rel = relative(resolveLoose(top.stdout.trim()), resolveLoose(fp));
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

export const requireWorktree = (ctx: HookCtx, stdin = ""): number => {
  if (isRemote(ctx.env)) return 0;
  const gd = ctx.git(["rev-parse", "--git-dir"]);
  // Not a git repo (or no git): nothing to guard.
  if (gd.status !== 0) return 0;
  // In a linked worktree the git-dir is .git/worktrees/<name>.
  if (gd.stdout.includes(".git/worktrees/")) return 0;
  // Memory files, the scratchpad, ~/.claude: not part of the checkout.
  if (targetsOutsideRepo(ctx, stdin)) return 0;

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

if (import.meta.main) runHook("guard", (ctx, stdin) => requireWorktree(ctx, stdin));
