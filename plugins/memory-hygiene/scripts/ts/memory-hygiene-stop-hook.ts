// Stop hook: reminds Claude to write a memory update before ending a turn
// that leaves uncommitted git changes behind, the session-close habit
// documented in the memory-hygiene skill.
//
// Off by default: a project or session must opt in via the MEMORY_HYGIENE_REMINDER
// env var (1/true/yes/on). A project can set it for every session through
// .claude/settings.json's own "env" key (a bespoke top-level key is rejected
// by the CLI's settings validation):
//   { "env": { "MEMORY_HYGIENE_REMINDER": "on" } }
//
// `Stop` fires once per TURN, not once per session
// (https://code.claude.com/docs/en/hooks#stop), so a naive "always remind"
// would nag on nearly every turn. This hook throttles itself to one reminder
// per session via a marker file keyed on session_id, and fires only when the
// repo has uncommitted changes.
//
// Informational, so fail open: any internal error exits 0.
//
// ponytail: "uncommitted changes exist" is a cheap stand-in for "durable work
// happened and isn't captured yet". It misses a turn that already committed
// everything, and once the marker is set it won't re-fire later in the same
// session. Upgrade path: check git reflog for commits since session start.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly git: (
    cwd: string,
    args: readonly string[],
  ) => { readonly status: number; readonly stdout: string };
  readonly out: (text: string) => void;
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

const OPT_IN = ["1", "true", "yes", "on"];

export const REMINDER = {
  hookSpecificOutput: {
    hookEventName: "Stop",
    decision: "block",
    reason:
      "Uncommitted changes exist and no memory update has been noted yet this session.",
    additionalContext:
      "Before finishing: if anything durable happened this session (a decision, a fix, a gotcha worth remembering), write or update a memory now, per the memory-hygiene skill. Skip this if nothing durable happened.",
  },
};

export const run = (d: Deps): number => {
  let input: Record<string, unknown> | undefined;
  try {
    input = asObject(JSON.parse(d.stdin));
  } catch {
    return 0;
  }
  if (input?.["stop_hook_active"] === true) return 0;
  const cwd = input?.["cwd"];
  const rawSession = input?.["session_id"];
  const session =
    typeof rawSession === "string" ? rawSession.replace(/[^A-Za-z0-9_-]/g, "") : "";
  if (typeof cwd !== "string" || cwd === "" || session === "") return 0;
  if (!OPT_IN.includes(d.env["MEMORY_HYGIENE_REMINDER"] ?? "")) return 0;

  // At most one reminder per session.
  const markerDir = join(d.env["TMPDIR"] ?? "/tmp", "agent-config-memory-hygiene");
  try {
    mkdirSync(markerDir, { recursive: true });
  } catch {
    return 0;
  }
  const marker = join(markerDir, session);
  if (existsSync(marker)) return 0;

  if (d.git(cwd, ["rev-parse", "--is-inside-work-tree"]).status !== 0) return 0;
  const status = d.git(cwd, ["status", "--porcelain"]);
  if (status.status !== 0 || status.stdout.trim() === "") return 0;

  try {
    closeSync(openSync(marker, "w"));
  } catch {
    // Throttle is best effort; still remind.
  }
  d.out(`${JSON.stringify(REMINDER)}\n`);
  return 0;
};

const realDeps = (): Deps => ({
  env: process.env,
  stdin: readFileSync(0, "utf8"),
  git: (cwd, args) => {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    return { status: r.status ?? 1, stdout: r.stdout };
  },
  out: (t) => process.stdout.write(t),
});

if (import.meta.main) {
  try {
    process.exitCode = run(realDeps());
  } catch {
    process.exitCode = 0;
  }
}
