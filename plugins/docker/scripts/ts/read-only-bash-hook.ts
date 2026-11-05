// PreToolUse hook (Bash): deny any Bash command from the docker-diagnoser subagent
// that is not on a read-only allowlist. A subagent frontmatter `tools: Bash` cannot
// be narrowed (a `Bash(...)` entry removes the whole tool), and plugin-agent
// frontmatter hooks are ignored, but hooks from settings and plugins do run inside
// subagents and carry `agent_type` (https://code.claude.com/docs/en/hooks). Every
// other caller, the main session included, gets no opinion. Fails closed for the
// diagnoser, open for everything else. Standalone: node builtins only.

const AGENT = /(^|:)docker-diagnoser$/;
const READ_ONLY = new Set(["ls", "cat", "head", "tail", "wc", "grep", "sort", "uniq", "cut", "jq", "pwd", "stat", "du", "df"]);
const GIT_READ = new Set(["status", "log", "diff", "show", "ls-files", "rev-parse", "blame"]);
const DOCKER_READ = new Set(["ps", "images", "inspect", "version", "info", "logs", "system df", "compose config", "compose ps", "compose logs"]);
// Docker global options that take a value, e.g. `docker -H tcp://h:2375 ps`.
const DOCKER_GLOBAL = new Set(["-H", "--host", "--context", "-c", "--log-level"]);
const SCRATCH = /^(\/private)?\/tmp\//;

const words = (s: string): string[] => s.split(/\s+/).filter((w) => w !== "");

/** Why one simple command (no separators) is not allowed, or undefined. */
const checkSimple = (part: string): string | undefined => {
  const w = words(part);
  const cmd = w[0];
  if (cmd === undefined) return undefined;
  if (READ_ONLY.has(cmd)) {
    return cmd === "sort" && w.some((x) => /^(-o|--output)/.test(x)) ? "sort -o writes a file" : undefined;
  }
  if (cmd === "git") {
    const i = w[1] === "-C" ? 3 : 1;
    const sub = w[i] ?? "";
    return GIT_READ.has(sub) && !w.some((x) => x.startsWith("--output"))
      ? undefined
      : `git ${sub} is not read-only`;
  }
  if (cmd === "docker") {
    let i = 1;
    while (DOCKER_GLOBAL.has(w[i] ?? "")) i += 2;
    const sub = w[i] ?? "";
    const key = sub === "compose" ? `compose ${firstNonFlag(w, i + 1)}` : sub === "system" ? `system ${w[i + 1] ?? ""}` : sub;
    if (!DOCKER_READ.has(key)) return `docker ${key} is not in the Run freely tier`;
    if (/\blogs$/.test(key) && w.some((x) => x === "-f" || x === "--follow")) {
      return "docker logs -f streams until stopped; use --tail or --since";
    }
    return undefined;
  }
  return `${cmd} is not on the read-only list`;
};

/** First word at or after i that is not a flag (compose `-f file` takes a value). */
const firstNonFlag = (w: readonly string[], from: number): string => {
  for (let i = from; i < w.length; i++) {
    const x = w[i] ?? "";
    if (x === "-f" || x === "--file" || x === "-p" || x === "--project-name") i++;
    else if (!x.startsWith("-")) return x;
  }
  return "";
};

/** A reason to deny, or undefined when every part of the command is read-only. */
export const checkCommand = (command: string): string | undefined => {
  if (/`|\$\(|<\(|<<|\n/.test(command)) {
    return "substitution, process substitution, heredocs and newlines are not allowed";
  }
  // Redirects: 2>&1 and >/dev/null are inert; anything else must land in /tmp.
  const stripped = command.replace(/\d?>&\d|\d?>>?\s*\/dev\/null/g, "");
  for (const m of stripped.matchAll(/>>?\s*(\S*)/g)) {
    if (!SCRATCH.test(m[1] ?? "")) return `redirect to '${m[1] ?? ""}' is outside the scratchpad`;
  }
  const parts = stripped.replace(/>>?\s*\S+/g, "").split(/&&|\|\||;|\||&/);
  for (const p of parts) {
    const why = checkSimple(p.trim());
    if (why !== undefined) return why;
  }
  return undefined;
};

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null;

/** stdin JSON in, stdout JSON out ("" = no opinion). Never throws. */
export const runHook = (raw: string): string => {
  try {
    const e: unknown = JSON.parse(raw);
    if (!isRecord(e) || e["tool_name"] !== "Bash") return "";
    const type = e["agent_type"];
    if (typeof type !== "string" || !AGENT.test(type)) return "";
    const input = e["tool_input"];
    const command = isRecord(input) ? input["command"] : undefined;
    const why = typeof command === "string" ? checkCommand(command) : "no command to check";
    return why === undefined
      ? ""
      : `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `docker-diagnoser is read-only: ${why}. Name the command in your report for the caller to run.`,
          },
        })}\n`;
  } catch {
    return "";
  }
};

if (import.meta.main) {
  const chunks: string[] = [];
  for await (const c of process.stdin) chunks.push(String(c));
  process.stdout.write(runHook(chunks.join("")));
}
