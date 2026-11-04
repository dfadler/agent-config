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
 * Unverified: whether this hook fires for a subagent inside `claude plugin eval`.
 * By design the agent's "never read evals/" prose is therefore not testable by an
 * eval: the hook, not the prose, is what the tests pin.
 */

const AGENT = "blind-case-writer";

/** `evals/` or `results/` as a path segment (or glob piece), or a case or grants file. */
const FORBIDDEN = /(^|[/\\*])(evals|results)([/\\*]|$)|case\.yaml|grants\.yaml/;

const ALLOW = { code: 0, message: "" } as const;

const asRecord = (v: unknown): Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v)) : {};

/** Path-like inputs of Read (file_path), Glob (pattern, path) and Grep (path, glob). Grep's `pattern` is content, not a path. */
const pathsOf = (tool: unknown, input: Readonly<Record<string, unknown>>): string[] =>
  [input["file_path"], input["path"], input["glob"], tool === "Glob" ? input["pattern"] : undefined].filter(
    (v): v is string => typeof v === "string",
  );

/** Exit code and stderr message for one hook event; code 0 allows. */
export const decide = (raw: string): { readonly code: 0 | 2; readonly message: string } => {
  try {
    const event = asRecord(JSON.parse(raw));
    const agent = event["agent_type"];
    if (typeof agent !== "string" || !agent.endsWith(AGENT)) return ALLOW;
    const hit = pathsOf(event["tool_name"], asRecord(event["tool_input"])).find((p) => FORBIDDEN.test(p));
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

if (import.meta.main) {
  const { code, message } = decide(await readStdin().catch(() => ""));
  if (message !== "") process.stderr.write(`${message}\n`);
  process.exit(code);
}
