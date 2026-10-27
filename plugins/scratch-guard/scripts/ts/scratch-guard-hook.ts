// PreToolUse hook: warn (default) or block when Edit/Write targets a system
// temp directory that is not the session scratchpad, backing the
// claude/conventions/scratch-files.md convention.
//
// Mode: SCRATCH_GUARD env var (off, warn, block); default warn, and any
// other value is treated as warn. Warn adds
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
// The current session's scratchpad (/tmp/claude-<uid>/<project>/<session_id>/
// scratchpad; the session dir name equals the hook input's session_id), or the
// documented no-scratchpad fallback dir (mktemp -d /tmp/scratch.XXXXXX) from
// the scratch-files convention. Without a session_id any session's scratchpad
// is accepted.
const scratchPattern = (session: string): RegExp =>
  new RegExp(
    `^/(?:private/)?tmp/(?:claude-\\d+/[^/]+/${session === "" ? "[^/]+" : session}/scratchpad|scratch\\.[A-Za-z0-9]{6})(?:/|$)`,
  );

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

export const run = (d: Deps): number => {
  // Only an explicit "off" disables the guard; an empty or misspelled value
  // stays active as "warn" rather than silently turning enforcement off.
  const setting = d.env["SCRATCH_GUARD"];
  if (setting === "off") return 0;
  const mode = setting === "block" ? "block" : "warn";
  let raw: unknown;
  let cwd: unknown;
  let session: unknown;
  try {
    const input = asObject(JSON.parse(d.stdin));
    raw = asObject(input?.["tool_input"])?.["file_path"];
    cwd = input?.["cwd"];
    session = input?.["session_id"];
  } catch {
    return 0;
  }
  if (typeof raw !== "string") return 0;
  // Resolve relative paths against cwd and fold "..", so neither
  // "../tmp/x" nor "scratchpad/../x" slips past the checks.
  const path = resolve(typeof cwd === "string" && cwd.startsWith("/") ? cwd : "/", raw);
  // Strip to the characters a session id can hold so it is safe in a RegExp.
  const id = typeof session === "string" ? session.replace(/[^A-Za-z0-9-]/g, "") : "";
  if (!TEMP_ROOT.test(path) || scratchPattern(id).test(path)) return 0;

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
