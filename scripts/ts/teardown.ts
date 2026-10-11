// Undo setup.sh: remove this repo's symlinks from ~/.claude/ and restore
// ~/.claude/CLAUDE.md from ~/.claude/CLAUDE.personal.md. Run via the
// ./teardown.sh shim at the repo root.
//
// Safe to re-run: only touches symlinks that point into this repo; skips
// anything that has already been removed. Every path is derived from the
// `home` and `repoRoot` arguments, so tests run against a temp directory.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deregisterHook, hookIs, isRecord, type JsonObject } from "./hook-settings.ts";
import { allHookForms, HOOK_TABLE_FILE, parseHookTable } from "./hook-table.ts";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./lib/exit-codes.ts";

// Must match scripts/claude-md-lib.sh (teardown.test.ts asserts they do).
export const MANAGED_BEGIN = "# >>> agent-config managed begin <<<";
export const MANAGED_END = "# >>> agent-config managed end <<<";

export const USAGE = `Usage: ./teardown.sh [--commands] [--plugins] [--claude-md]

Removes this repo's symlinks from ~/.claude and restores ~/.claude/CLAUDE.md
from ~/.claude/CLAUDE.personal.md (the inverse of setup.sh). With no flags,
does the full teardown. Pass one or more flags to remove only that part;
flags are combinable.

  --commands    Only unlink ~/.claude/commands/* entries pointing into this repo.
  --plugins     Only unlink ~/.claude/skills/* entries pointing into this repo's plugins/.
  --claude-md   Only restore ~/.claude/CLAUDE.md / CLAUDE.personal.md.
  -h, --help    Show this message and exit.
`;

type Log = (line: string) => void;

const isSymlink = (p: string): boolean => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

const exists = (p: string): boolean => existsSync(p) || isSymlink(p);

/**
 * Absolute form of a symlink's stored target, or undefined when its parent
 * directory is unreachable (the caller then leaves the link alone). Works for
 * a target that no longer exists.
 */
const resolveTarget = (target: string, linkDir: string): string | undefined => {
  if (target.startsWith("/")) return target;
  const full = resolve(linkDir, target);
  try {
    return statSync(dirname(full)).isDirectory() ? full : undefined;
  } catch {
    return undefined;
  }
};

/** Remove a symlink only if it points exactly to `src`. */
export const unlinkIfOwned = (dest: string, src: string, log: Log): void => {
  if (!isSymlink(dest)) return;
  if (resolveTarget(readlinkSync(dest), dirname(dest)) !== src) return;
  rmSync(dest);
  log(`Removed symlink: ${dest}`);
};

/** Remove symlinks in `destDir` whose targets fall anywhere under `srcDir`. */
export const unlinkDirContents = (destDir: string, srcDir: string, log: Log): void => {
  if (!existsSync(destDir)) return;
  for (const name of readdirSync(destDir).sort()) {
    const entry = join(destDir, name);
    if (!isSymlink(entry)) continue;
    const target = resolveTarget(readlinkSync(entry), destDir);
    if (target?.startsWith(`${srcDir}/`) === true) {
      rmSync(entry);
      log(`Removed symlink: ${entry}`);
    }
  }
};

/** `text` without its managed section, leading blank lines and trailing newlines. */
export const stripManagedSection = (text: string): string => {
  const out: string[] = [];
  let inSection = false;
  for (const line of text.split("\n")) {
    if (line === MANAGED_BEGIN) inSection = true;
    else if (line === MANAGED_END) inSection = false;
    else if (!inSection) out.push(line);
  }
  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
};

/**
 * Restore CLAUDE.md. Handles the legacy symlink format (remove the repo link)
 * and the current generated file (strip the managed section, keep user
 * additions). Then a non-empty CLAUDE.personal.md moves back to CLAUDE.md; an
 * empty one with a .setup-managed sidecar is removed; a user-owned empty one
 * is left alone.
 */
export const restoreClaudeMd = (home: string, repoRoot: string, log: Log): void => {
  const link = join(home, ".claude", "CLAUDE.md");
  const personal = join(home, ".claude", "CLAUDE.personal.md");
  const marker = `${personal}.setup-managed`;

  if (isSymlink(link)) {
    unlinkIfOwned(link, join(repoRoot, "claude", "CLAUDE.md"), log);
  } else if (existsSync(link) && statSync(link).isFile()) {
    const text = readFileSync(link, "utf8");
    if (text.includes(MANAGED_BEGIN)) {
      const rest = stripManagedSection(text);
      if (rest === "") {
        rmSync(link);
        log(`Removed empty ${link}`);
      } else {
        writeFileSync(link, `${rest}\n`);
        log(`Removed managed section from ${link}`);
      }
    }
  }

  if (!existsSync(personal)) return;
  if (statSync(personal).size > 0) {
    if (exists(link)) {
      process.stderr.write(`Skipping restore: ${link} already exists\n`);
    } else {
      renameSync(personal, link);
      rmSync(marker, { force: true });
      log(`Restored ${personal} → ${link}`);
    }
  } else if (existsSync(marker)) {
    rmSync(personal);
    rmSync(marker);
    log(`Removed empty ${personal} (placeholder created by setup.sh)`);
  }
};

/**
 * Deregister every hook-table hook from settings.json, in every form it has
 * been registered in: exec (current), shell, and the retired .sh path.
 */
export const deregisterPluginHooks = (home: string, repoRoot: string, log: Log): number => {
  const settings = join(home, ".claude", "settings.json");
  if (!existsSync(settings)) return EXIT_OK;
  const table = parseHookTable(readFileSync(join(repoRoot, HOOK_TABLE_FILE), "utf8"));
  if (table.tag === "err") {
    process.stderr.write(`${HOOK_TABLE_FILE}: ${table.error}\n`);
    return EXIT_FAILURE;
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(settings, "utf8"));
  } catch {
    process.stderr.write(`Warning: ${settings} is not valid JSON; hooks not deregistered\n`);
    return EXIT_FAILURE;
  }
  if (!isRecord(data)) return EXIT_OK;
  let current: JsonObject = data;
  for (const row of table.value) {
    for (const form of allHookForms(row, home)) {
      const next = deregisterHook(current, row.event, (h) => hookIs(h, form));
      if (next !== undefined) {
        current = next;
        writeFileSync(settings, `${JSON.stringify(current, null, 4)}\n`);
        log(`Deregistered ${row.event} hook from ${settings}`);
      }
    }
  }
  return EXIT_OK;
};

export interface Options {
  readonly commands: boolean;
  readonly plugins: boolean;
  readonly claudeMd: boolean;
}

/** `Options`, or the offending argument. No flags selects everything. */
export const parseArgs = (argv: readonly string[]): Options | { readonly bad: string } | "help" => {
  let o = { commands: false, plugins: false, claudeMd: false };
  for (const a of argv) {
    if (a === "-h" || a === "--help") return "help";
    else if (a === "--commands") o = { ...o, commands: true };
    else if (a === "--plugins") o = { ...o, plugins: true };
    else if (a === "--claude-md") o = { ...o, claudeMd: true };
    else return { bad: a };
  }
  return o.commands || o.plugins || o.claudeMd
    ? o
    : { commands: true, plugins: true, claudeMd: true };
};

/** The whole teardown; returns the exit code. */
export const teardown = (
  opts: Options,
  home: string,
  repoRoot: string,
  log: Log,
): number => {
  if (opts.claudeMd) restoreClaudeMd(home, repoRoot, log);
  if (opts.commands) {
    unlinkDirContents(join(home, ".claude", "commands"), join(repoRoot, "claude", "commands"), log);
  }
  const rc = opts.plugins
    ? (unlinkDirContents(join(home, ".claude", "skills"), join(repoRoot, "plugins"), log),
      deregisterPluginHooks(home, repoRoot, log))
    : EXIT_OK;
  log("Done.");
  return rc;
};

if (import.meta.main) {
  const parsed = parseArgs(process.argv.slice(2));
  const out: Log = (line) => {
    process.stdout.write(`${line}\n`);
  };
  if (parsed === "help") {
    process.stdout.write(USAGE);
  } else if ("bad" in parsed) {
    process.stderr.write(`Unknown argument: ${parsed.bad}\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  } else {
    const home = process.env["HOME"] ?? "";
    if (home === "") {
      process.stderr.write("teardown: HOME is not set\n");
      process.exit(EXIT_USAGE);
    }
    const repoRoot = realpathSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
    process.exitCode = teardown(parsed, home, repoRoot, out);
  }
}
