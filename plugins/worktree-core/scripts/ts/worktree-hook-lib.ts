// Shared helpers for the worktree-core hooks (require-worktree-hook.ts,
// check-worktree-symlinks-hook.ts, prune-merged-worktrees-hook.ts).
// Standalone: node builtins only, because a plugin installs on its own.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export type Env = Readonly<Record<string, string | undefined>>;

export interface GitResult {
  readonly status: number;
  readonly stdout: string;
}
export type Git = (args: readonly string[]) => GitResult;
export type ReadFile = (path: string) => string;

/** Effects a hook body uses; injected so tests need no process or repo. */
export interface HookCtx {
  readonly env: Env;
  readonly git: Git;
  readonly readFile: ReadFile;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** Run `node <script.ts> <args>`; stdout and stderr come back separately. */
  readonly script: (
    script: string,
    args: readonly string[],
  ) => { readonly stdout: string; readonly stderr: string };
}

export const realCtx = (): HookCtx => ({
  env: process.env,
  git: (args) => {
    const r = spawnSync("git", [...args], { encoding: "utf8" });
    // status is null when git is missing or killed: treat as "failed".
    return { status: r.status ?? 1, stdout: r.stdout };
  },
  readFile: (path) => readFileSync(path, "utf8"),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  script: (script, args) => {
    const r = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    return { stdout: r.stdout, stderr: r.stderr };
  },
});

/**
 * Exit code Claude Code treats as blocking. Only 2 blocks a PreToolUse hook;
 * any other non-zero code lets the tool call proceed.
 * https://code.claude.com/docs/en/hooks (exit codes)
 */
export const EXIT_BLOCK = 2;

export type HookKind = "guard" | "informational";

/**
 * Run a hook body and map its outcome to an exit code. A throw is an internal
 * failure: a guard fails closed (exit 2) so a crashed guard cannot silently
 * stop enforcing; an informational hook fails open (exit 0) so it can never
 * break a session.
 */
export const hookExitCode = (
  kind: HookKind,
  body: () => number,
  err: (text: string) => void,
): number => {
  try {
    return body();
  } catch (thrown) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    err(`worktree-core hook internal error: ${msg}\n`);
    return kind === "guard" ? EXIT_BLOCK : 0;
  }
};

/** The one place a hook entrypoint touches the process. */
export const runHook = (
  kind: HookKind,
  body: (ctx: HookCtx) => number,
): void => {
  const ctx = realCtx();
  process.exitCode = hookExitCode(kind, () => body(ctx), ctx.err);
};

/** Cloud/remote sessions have no worktrees; every hook skips them. */
export const isRemote = (env: Env): boolean =>
  env["CLAUDE_CODE_REMOTE"] === "true";

/** Parsed `<toplevel>/.claude/settings.json`, or undefined when unavailable. */
export const readSettings = (ctx: HookCtx): unknown => {
  const top = ctx.git(["rev-parse", "--show-toplevel"]);
  if (top.status !== 0) return undefined;
  try {
    return JSON.parse(
      ctx.readFile(`${top.stdout.trim()}/.claude/settings.json`),
    );
  } catch {
    // Absent or malformed settings mean "not configured".
    return undefined;
  }
};

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null
    ? Object.fromEntries(Object.entries(v))
    : undefined;

/** Read `settings.worktree.<key>`; undefined when any step is missing. */
export const worktreeSetting = (settings: unknown, key: string): unknown =>
  asRecord(asRecord(settings)?.["worktree"])?.[key];

/** Map boolean-ish spellings to "on"/"off"; anything else passes through. */
const normalize = (v: string): string => {
  if (["0", "false", "no", "off"].includes(v)) return "off";
  if (["1", "true", "yes", "on"].includes(v)) return "on";
  return v;
};

/**
 * Resolve an enable-mode: env var (with boolean synonyms) first, then the
 * project settings value (matched literally; `fromSettings` does any
 * translation), then `fallback`. Only members of `valid` are accepted from
 * either source. See docs/hook-composition.md.
 */
export const resolveEnableMode = (
  ctx: HookCtx,
  opts: {
    readonly envVar: string;
    readonly fromSettings: (settings: unknown) => string;
    readonly fallback: string;
    readonly valid: readonly string[];
  },
): string => {
  const fromEnv = normalize(ctx.env[opts.envVar] ?? "");
  if (fromEnv !== "" && opts.valid.includes(fromEnv)) return fromEnv;
  const fromFile = opts.fromSettings(readSettings(ctx));
  return opts.valid.includes(fromFile) ? fromFile : opts.fallback;
};

/** Settings reader for a plain string key, "" when absent or not a string. */
export const stringSetting =
  (key: string) =>
  (settings: unknown): string => {
    const v = worktreeSetting(settings, key);
    return typeof v === "string" ? v : "";
  };
