/**
 * PreToolUse hook: keeps the `blind-case-writer` agent blind. That agent drafts
 * eval cases from the skill text alone; if it reads the existing cases, grants or
 * results, its draft inherits the author's blind spots and the diff is worthless.
 * Its prompt says not to look; this makes the tools refuse.
 *
 * Contract (https://code.claude.com/docs/en/hooks, PreToolUse): stdin JSON carries
 * `tool_name`, `tool_input` and, inside a subagent, `agent_type` and `agent_id`;
 * exit 2 blocks the call and feeds stderr back to Claude. Any other exit is
 * non-blocking, so every failure path below exits 0 (fail open).
 *
 * The agent_type of a plugin subagent is `<plugin>:<agent>` as far as the Agent
 * tool listing shows, but that string is unverified here, hence the suffix match.
 * No agent_type (the parent session) or any other agent: allow.
 *
 * What is blocked:
 * - any path or glob naming `case.yaml` or `grants.yaml`;
 * - a plain path inside a plugin's own `evals/` or `results/` directory (first
 *   segment, `plugins/<name>/`, or an ancestor directory holding
 *   `.claude-plugin/plugin.json`), so a checkout that merely lives under a
 *   directory called `results/` is not blocked;
 * - a string with glob metacharacters naming `evals` or `results` as a segment
 *   (it cannot be resolved, so the broad rule applies);
 * - a Glob `pattern` or Grep `glob` that CAN match a protected path (a hook
 *   cannot filter results, so `**` or `**\/*.yaml` at a plugin root is refused).
 *
 * Remaining limit: a Grep with no `glob` over a plugin root, and a broad Glob
 * with a non-recursive pattern, are not covered. blind-case-writer has no Grep
 * tool, so the first matters only if its tool list changes.
 *
 * Unverified: whether this hook fires for a subagent inside `claude plugin eval`.
 * By design the agent's "never read evals/" prose is therefore not testable by an
 * eval: the hook, not the prose, is what the tests pin.
 */
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const AGENT = "blind-case-writer";

/** A case or grants file, wherever it is. */
const PROTECTED_FILE = /case\.yaml|grants\.yaml/;

/** `evals` or `results` as a path segment or glob piece: used when the string cannot be resolved (it has glob metacharacters). */
const BROAD_DIR = /(^|[/\\*])(evals|results)([/\\*]|$)/;

const HAS_GLOB = /[*?{[]/;

const ALLOW = { code: 0, message: "" } as const;

const asRecord = (v: unknown): Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : {};

/** True when `dir` is a plugin root. Fails open: an fs error counts as no. */
const isPluginRoot = (dir: string): boolean => {
  try {
    return existsSync(`${dir}/.claude-plugin/plugin.json`);
  } catch {
    return false;
  }
};

/** A plain (no glob metacharacters) path inside a plugin's own evals/ or results/ directory. */
const inPluginDirs = (path: string): boolean => {
  const p = path.replaceAll("\\", "/");
  if (/^(\.\/)?(evals|results)(\/|$)/.test(p)) return true;
  if (/(^|\/)plugins\/[^/]+\/(evals|results)(\/|$)/.test(p)) return true;
  if (!p.startsWith("/")) return false;
  const segments = p.split("/");
  return segments.some((s, i) => (s === "evals" || s === "results") && i > 0 && isPluginRoot(segments.slice(0, i).join("/")));
};

/** Whether one path-like string (a path, or a glob treated as text) names protected ground. */
const isProtectedPath = (p: string): boolean =>
  PROTECTED_FILE.test(p) || (HAS_GLOB.test(p) ? BROAD_DIR.test(p) : inPluginDirs(p));

/** Simple glob to regex: `**\/` any directories, `**` anything, `*` and `?` within a segment, `{a,b}` alternation; everything else literal. */
export const globToRegExp = (glob: string): RegExp => {
  let out = "";
  let braces = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === "*" && glob.charAt(i + 1) === "*") {
      const slash = glob.charAt(i + 2) === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "{") {
      braces++;
      out += "(?:";
    } else if (c === "}" && braces > 0) {
      braces--;
      out += ")";
    } else if (c === "," && braces > 0) out += "|";
    else out += c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  }
  return new RegExp(`^${out}${")".repeat(braces)}$`);
};

/** Protected paths a search can be aimed at, for matching a glob against. */
const SAMPLES = [
  "evals/zz/case.yaml",
  "evals/zz/grants.yaml",
  "evals/zz/prompt.md",
  "plugins/zz/evals/zz/case.yaml",
  "results/zz/aggregate-result.json",
];

/** The glob's literal directory prefix: text before the first metacharacter, cut back to the last `/`. */
const literalPrefix = (glob: string): string => {
  const head = glob.slice(0, glob.search(HAS_GLOB) === -1 ? glob.length : glob.search(HAS_GLOB));
  return head.slice(0, head.lastIndexOf("/") + 1);
};

/** Whether the glob can match a protected path, bare or under its own literal directory prefix. */
const globReaches = (glob: string): boolean => {
  const re = globToRegExp(glob);
  const prefix = literalPrefix(glob);
  return (
    SAMPLES.some((s) => re.test(s)) ||
    (prefix !== "" && SAMPLES.some((s) => re.test(prefix + s) && inPluginDirs(prefix + s)))
  );
};

/** The strings a call aims at: paths (Read file_path, `path`), and globs (Glob `pattern`, Grep `glob`). Grep's `pattern` is content, not a path. */
const targets = (tool: unknown, input: Readonly<Record<string, unknown>>): { paths: string[]; globs: string[] } => {
  const str = (v: unknown): string[] => (typeof v === "string" ? [v] : []);
  const base = str(input["path"]);
  const globs = [...(tool === "Glob" ? str(input["pattern"]) : []), ...str(input["glob"])];
  return {
    paths: [...str(input["file_path"]), ...base, ...globs],
    globs: [...globs, ...base.flatMap((b) => globs.map((g) => `${b.replace(/\/$/, "")}/${g}`))],
  };
};

/** Exit code and stderr message for one hook event; code 0 allows. */
export const decide = (raw: string): { readonly code: 0 | 2; readonly message: string } => {
  try {
    const event = asRecord(JSON.parse(raw));
    const agent = event["agent_type"];
    if (typeof agent !== "string" || !agent.endsWith(AGENT)) return ALLOW;
    const { paths, globs } = targets(event["tool_name"], asRecord(event["tool_input"]));
    const hit = paths.find(isProtectedPath) ?? globs.find(globReaches);
    return hit === undefined
      ? ALLOW
      : {
          code: 2,
          message: `Blocked: ${AGENT} drafts from the skill text alone and must not look at existing eval cases, grants or results ('${hit}'). Work from the skill or agent file you were given.`,
        };
  } catch {
    return ALLOW;
  }
};

const readStdin = async (): Promise<string> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
};

/** Direct-entrypoint check that works on every Node version (`import.meta.main` needs 22.18+/24.2+). */
const isEntrypoint = (): boolean => {
  try {
    const entry = process.argv[1];
    return entry !== undefined && fileURLToPath(import.meta.url) === realpathSync(entry);
  } catch {
    return false;
  }
};

if (isEntrypoint()) {
  const { code, message } = decide(await readStdin().catch(() => ""));
  if (message !== "") process.stderr.write(`${message}\n`);
  process.exit(code);
}
