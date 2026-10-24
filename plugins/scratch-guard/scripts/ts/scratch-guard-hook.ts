// PreToolUse hook: warn (default) or block when Edit/Write targets a system
// temp directory that is not the session scratchpad, backing the
// claude/conventions/scratch-files.md convention.
//
// Mode: SCRATCH_GUARD env var (off, warn, block); default warn. Warn adds
// context for Claude and lets the write proceed; block exits 2.
//
// Covers Edit/Write only. Bash writes (redirects, mktemp, curl -o) are not
// inspected.
//
// ponytail: a fixed list of temp roots plus the /claude-<uid>/.../scratchpad
// layout. The layout is a prompt-level convention rather than a documented
// API, so a layout change makes this warn on legitimate scratchpad writes;
// loosen SCRATCH_PATTERN then.
import { readFileSync } from "node:fs";
import { resolve } from "node:path/posix";

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

const TEMP_ROOT = /^\/(?:private\/)?(?:tmp|var\/tmp|var\/folders)\//;
// The session scratchpad, or the documented no-scratchpad fallback dir
// (mktemp -d /tmp/scratch.XXXXXX) from the scratch-files convention.
const SCRATCH_PATTERN =
  /^\/(?:private\/)?tmp\/(?:claude-\d+\/.+\/scratchpad|scratch\.[A-Za-z0-9]{6})(?:\/|$)/;

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

export const run = (d: Deps): number => {
  const mode = d.env["SCRATCH_GUARD"] ?? "warn";
  if (mode !== "warn" && mode !== "block") return 0;
  let raw: unknown;
  let cwd: unknown;
  try {
    const input = asObject(JSON.parse(d.stdin));
    raw = asObject(input?.["tool_input"])?.["file_path"];
    cwd = input?.["cwd"];
  } catch {
    return 0;
  }
  if (typeof raw !== "string") return 0;
  // Resolve relative paths against cwd and fold "..", so neither
  // "../tmp/x" nor "scratchpad/../x" slips past the checks.
  const path = resolve(typeof cwd === "string" && cwd.startsWith("/") ? cwd : "/", raw);
  if (!TEMP_ROOT.test(path) || SCRATCH_PATTERN.test(path)) return 0;

  const msg =
    `${path} is in a system temp directory. Write temporary files to the ` +
    "session scratchpad named in the environment instead (see the scratch-files convention).";
  if (mode === "block") {
    d.err(`${msg}\nSet SCRATCH_GUARD=warn or off to allow it.\n`);
    return 2;
  }
  d.out(
    `${JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
    })}\n`,
  );
  return 0;
};

if (import.meta.main) {
  try {
    process.exitCode = run({
      env: process.env,
      stdin: readFileSync(0, "utf8"),
      out: (t) => process.stdout.write(t),
      err: (t) => process.stderr.write(t),
    });
  } catch {
    process.exitCode = 0;
  }
}
