// Verify that every directory a project symlinks into its worktrees (per
// .claude/settings.json's worktree.symlinkDirectories, e.g. a heavy
// node_modules or vendor directory) actually resolves back to the MAIN
// checkout, and optionally repair it.
//
// `worktree.symlinkDirectories` is NOT a Claude Code setting: EnterWorktree and
// `--worktree` only check out tracked files. A project that shares one copy of
// a heavy untracked directory across worktrees creates that symlink itself and
// lists it here so this script (and its SessionStart hook) can verify it. This
// script only verifies and repairs; it never originates a symlink.
//
// Why: whatever creates these symlinks can race under heavy parallel worktree
// creation, leaving a link resolving to a sibling worktree (maybe already
// deleted) instead of the main checkout. Running with --fix at session start
// catches that immediately.
//
// It does NOT touch a directory that isn't a symlink: a worktree whose copy was
// already materialized into a real directory is left alone.
//
// Usage:
//   verify-worktree-symlinks.ts          # check only; reports mismatches
//   verify-worktree-symlinks.ts --fix    # also repair any mismatch found
//
// Exit codes: 0 all symlinks verified (or nothing to check), 1 a mismatch was
// found and not fixed, 2 bad usage, 3 worktree.symlinkDirectories itself is
// malformed (not valid JSON, or not an array).
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { asArray, asObject } from "./json.ts";
import { makeRun, type Env, type Run } from "./proc.ts";

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const EXIT_CONFIG = 3;

export const USAGE = `Usage: verify-worktree-symlinks.ts [-h|--help] [--fix]

Checks every directory named in .claude/settings.json's
worktree.symlinkDirectories: if it's a symlink in THIS worktree, confirms it
resolves to the main checkout's copy of that directory. Prints a mismatch
(wrong target, or a target that no longer exists) to stderr.

  --fix   Repair a mismatched symlink by relinking it to the main checkout.
          Never touches a directory that isn't a symlink (e.g. one already
          materialized into a real, independent copy).

No-op (exit 0) when run from the main checkout, or when
symlinkDirectories is empty/unset.
`;

export interface Ctx {
  readonly cwd: string;
  readonly run: Run;
  readonly out: (text: string) => void;
  readonly err: (line: string) => void;
}

/** jq-style type name, for error messages. */
const typeName = (v: unknown): string =>
  v === null ? "null" : Array.isArray(v) ? "array" : typeof v;

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export const main = (argv: readonly string[], ctx: Ctx): number => {
  let fix = false;
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      ctx.out(USAGE);
      return EXIT_OK;
    }
    if (arg === "--fix") fix = true;
    else {
      ctx.err(`Unknown argument: ${arg}`);
      ctx.err(USAGE);
      return EXIT_USAGE;
    }
  }

  const git = (args: readonly string[]) => ctx.run("git", args, ctx.cwd);
  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
    ctx.err("Not inside a git repository.");
    return EXIT_USAGE;
  }
  const self = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  // In a linked worktree --git-dir is .git/worktrees/<name> while
  // --git-common-dir is the main checkout's .git; in the main checkout the
  // two match.
  const gitDir = realpathSync(
    resolve(ctx.cwd, git(["rev-parse", "--git-dir"]).stdout.trim()),
  );
  const commonDir = realpathSync(
    resolve(ctx.cwd, git(["rev-parse", "--git-common-dir"]).stdout.trim()),
  );
  // Main checkout: nothing symlinks FROM it.
  if (gitDir === commonDir) return EXIT_OK;
  const mainCheckout = dirname(commonDir);

  const settingsFile = `${self}/.claude/settings.json`;
  if (!existsSync(settingsFile)) return EXIT_OK;

  const configError = (detail: string): number => {
    ctx.err(`verify-worktree-symlinks: ${detail}`);
    return EXIT_CONFIG;
  };
  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  } catch (thrown) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    return configError(
      `could not read worktree.symlinkDirectories\n  from ${settingsFile}: ${msg}`,
    );
  }
  const section = asObject(settings)?.["worktree"];
  if (section !== undefined && section !== null && asObject(section) === undefined)
    return configError(
      `could not read worktree.symlinkDirectories\n  from ${settingsFile}: worktree is a ${typeName(section)}`,
    );
  const raw = asObject(section)?.["symlinkDirectories"];
  // Key absent or explicitly null: nothing configured.
  if (raw === undefined || raw === null) return EXIT_OK;
  const entries = asArray(raw);
  if (entries === undefined)
    return configError(
      `${settingsFile}'s worktree.symlinkDirectories\n  must be an array, got ${typeName(raw)}.`,
    );

  let anyUnresolved = false;
  for (const dir of entries) {
    if (dir === "") continue;
    if (typeof dir !== "string") {
      ctx.err(`verify-worktree-symlinks: entry ${JSON.stringify(dir)} is not a string — skipping.`);
      anyUnresolved = true;
      continue;
    }
    // Project-controlled config is not trusted input: an absolute or `..`
    // entry must never reach --fix's unlink/symlink.
    if (dir.startsWith("/")) {
      ctx.err(`verify-worktree-symlinks: ${dir} is an absolute path — skipping.`);
      anyUnresolved = true;
      continue;
    }
    if (`/${dir}/`.includes("/../")) {
      ctx.err(`verify-worktree-symlinks: ${dir} contains a '..' segment — skipping.`);
      anyUnresolved = true;
      continue;
    }

    const path = `${self}/${dir}`;
    const mainPath = `${mainCheckout}/${dir}`;
    // Not a symlink here (missing, or already materialized): nothing to do.
    let isLink = false;
    try {
      isLink = lstatSync(path).isSymbolicLink();
    } catch {
      // missing
    }
    if (!isLink) continue;

    if (!isDir(mainPath)) {
      ctx.err(`verify-worktree-symlinks: ${dir} is a symlink but the main checkout`);
      ctx.err(`  has no ${dir} to point at (${mainPath} missing) — leaving as-is.`);
      anyUnresolved = true;
      continue;
    }
    const mainResolved = realpathSync(mainPath);

    const relink = (): void => {
      try {
        unlinkSync(path);
        symlinkSync(mainPath, path);
        ctx.err(`verify-worktree-symlinks: relinked ${dir} -> ${mainPath}`);
      } catch {
        ctx.err(`verify-worktree-symlinks: failed to relink ${dir}`);
        anyUnresolved = true;
      }
    };

    let target: string | undefined;
    try {
      const real = realpathSync(path);
      target = isDir(real) ? real : undefined;
    } catch {
      target = undefined;
    }
    if (target === undefined) {
      ctx.err(`verify-worktree-symlinks: ${dir} is a broken symlink (${readlinkSync(path)}).`);
      if (fix) relink();
      else anyUnresolved = true;
      continue;
    }
    if (target !== mainResolved) {
      ctx.err(`verify-worktree-symlinks: ${dir} resolves to ${target},`);
      ctx.err(`  not the main checkout (${mainResolved}).`);
      if (fix) relink();
      else anyUnresolved = true;
    }
  }
  return anyUnresolved ? EXIT_FAILURE : EXIT_OK;
};

export const realCtx = (env: Env = process.env): Ctx => ({
  cwd: process.cwd(),
  run: makeRun(env),
  out: (t) => process.stdout.write(t),
  err: (l) => process.stderr.write(`${l}\n`),
});

if (import.meta.main) process.exitCode = main(process.argv.slice(2), realCtx());
