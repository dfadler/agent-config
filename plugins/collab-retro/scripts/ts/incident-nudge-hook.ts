// UserPromptSubmit + Stop hook: a log-only nudge toward a collab-retro
// incident retro when the user shows visible frustration.
//
// - UserPromptSubmit: if the prompt matches a frustration phrase, append ONE
//   line (timestamp, matched phrase) to a per-session pending file. The prompt
//   text is not stored. Nothing is printed, blocked or posted.
// - Stop: if the pending file has a line and this session has not been nudged,
//   write a marker and ask Claude to offer an incident retro once. It only
//   offers; the skill runs only on the user's yes.
//
// Input fields verified against https://code.claude.com/docs/en/hooks
// (UserPromptSubmit input: common fields incl. session_id, hook_event_name,
// plus `prompt`; Stop input includes `stop_hook_active`; a Stop hook's
// top-level `decision: "block"` + `reason` makes Claude continue).
//
// Off by default: opt in with COLLAB_RETRO_NUDGE=1/true/yes/on, e.g. via
// settings.json's `env` key. Fails open: any error exits 0. Standalone.
//
// ponytail: a small fixed phrase list on short prompts stands in for
// frustration detection; it misses tone without these words. Upgrade path:
// grow the list from real incidents.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly now: Date;
  readonly out: (text: string) => void;
}

const OPT_IN = ["1", "true", "yes", "on"];
export const MAX_PROMPT_CHARS = 500; // long prompts are usually pasted content
export const PHRASES: readonly RegExp[] = [
  /\bi (already )?told you\b/i,
  /\bnot what i (asked|said|wanted)\b/i,
  /\bhow many times\b/i,
  /\byou keep (doing|making|ignoring|forgetting)\b/i,
  /\bwhy (did|do) you keep\b/i,
  /\bfor the (second|third|fourth) time\b/i,
];

export const NUDGE = {
  decision: "block",
  reason:
    "collab-retro: a frustration phrase was logged earlier this session. In one sentence, offer the user an incident retro (collab-retro skill, incident mode). Ask first; run it only on a yes, and drop it if they decline.",
};

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

export const run = (d: Deps): number => {
  if (!OPT_IN.includes(d.env["COLLAB_RETRO_NUDGE"] ?? "")) return 0;
  let input: Record<string, unknown> | undefined;
  try {
    input = asObject(JSON.parse(d.stdin));
  } catch {
    return 0;
  }
  const rawSession = input?.["session_id"];
  const session = typeof rawSession === "string" ? rawSession.replace(/[^A-Za-z0-9_-]/g, "") : "";
  if (session === "") return 0;

  const dir = join(d.env["TMPDIR"] ?? "/tmp", "agent-config-collab-retro");
  const pending = join(dir, `${session}.pending`);
  const nudged = join(dir, `${session}.nudged`);
  const event = input?.["hook_event_name"];

  if (event === "UserPromptSubmit") {
    const prompt = input?.["prompt"];
    if (typeof prompt !== "string" || prompt.length > MAX_PROMPT_CHARS) return 0;
    const hit = PHRASES.map((re) => re.exec(prompt)?.[0]).find((m) => m !== undefined);
    if (hit === undefined) return 0;
    try {
      mkdirSync(dir, { recursive: true });
      appendFileSync(pending, `${d.now.toISOString()} ${hit.toLowerCase()}\n`);
    } catch {
      // Log-only and best effort.
    }
    return 0;
  }

  if (event === "Stop") {
    if (input?.["stop_hook_active"] === true) return 0;
    if (existsSync(nudged) || !existsSync(pending)) return 0;
    try {
      closeSync(openSync(nudged, "w"));
    } catch {
      return 0; // cannot throttle, so do not nudge
    }
    d.out(`${JSON.stringify(NUDGE)}\n`);
  }
  return 0;
};

if (import.meta.main) {
  try {
    process.exitCode = run({
      env: process.env,
      stdin: readFileSync(0, "utf8"),
      now: new Date(),
      out: (t) => process.stdout.write(t),
    });
  } catch {
    process.exitCode = 0;
  }
}
