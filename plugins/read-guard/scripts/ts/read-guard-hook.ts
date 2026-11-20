// PreToolUse hook: ask (default) or deny before Read, Grep, Glob or Bash
// touches a directory the user listed in ~/.claude/read-guard.json
// (override the path with READ_GUARD_CONFIG), e.g.
//   { "directories": ["~/secrets", "/Users/me/private-notes"] }
//
// Mode: READ_GUARD env var (ask, deny, off); default ask, any other value is
// treated as ask so a typo never turns the gate off.
//
// Input/output schema: https://code.claude.com/docs/en/hooks (PreToolUse).
// Input: tool_input.file_path (Read), tool_input.path (Grep, Glob), and
// tool_input.pattern (Glob), tool_input.command (Bash), plus cwd. Output:
// hookSpecificOutput.permissionDecision "ask" | "deny" with
// permissionDecisionReason. Deny and ask rules in settings still apply, and
// when several hooks disagree deny > ask > allow, so this hook never needs to
// emit "allow"; exit 0 with no output means "no opinion".
//
// What it cannot catch: Bash is matched by literal path tokens only. Shell
// variables other than $HOME, $(...), backticks, globs that start above the
// protected directory (cat ~/sec*/x), paths built by scripts, and content read
// through a program the command runs (python -c, a script) are invisible.
// For a hard guarantee use permissions.deny Read(...) rules plus the sandbox
// filesystem deny list; this hook is the early, explainable layer on top.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";

export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly home: string;
  readonly readFile: (path: string) => string | undefined;
  readonly out: (text: string) => void;
}

const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

const expandHome = (p: string, home: string): string =>
  p === "~" || p === "$HOME" || p === "${HOME}"
    ? home
    : p.replace(/^(?:~|\$HOME|\$\{HOME\})\//, `${home}/`);

// Resolve "..", then follow symlinks on the longest prefix that exists, so a
// link into a protected directory (or a not-yet-created path under one) is
// still seen at its real location.
const real = (p: string): string => {
  let head = p;
  const tail: string[] = [];
  while (!existsSync(head) && dirname(head) !== head) {
    tail.unshift(head.slice(dirname(head).length + 1));
    head = dirname(head);
  }
  try {
    return resolve(realpathSync(head), ...tail);
  } catch {
    return p;
  }
};

const inside = (p: string, dir: string): boolean => p === dir || p.startsWith(dir + sep);

// Both the lexical and the symlink-resolved form must clear every directory.
const forms = (p: string): string[] => [p, real(p)];

interface Target {
  readonly path: string;
  // True when a recursive search from here would descend into a protected
  // directory below it (Grep/Glob only).
  readonly recursive: boolean;
}

const strip = (s: string): string => s.replace(/^['"]+|['"]+$/g, "").replace(/\\(.)/g, "$1");

// Glob prefix: the leading directory part that has no wildcard characters.
const globBase = (p: string): string => {
  const i = p.search(/[*?[{]/);
  return i === -1 ? p : p.slice(0, Math.max(p.lastIndexOf("/", i), 0)) || "/";
};

const bashTargets = (command: string, cwd: string, home: string): Target[] => {
  const out: Target[] = [{ path: cwd, recursive: false }];
  for (const raw of command.split(/[\s;|&<>()=,]+/)) {
    const tok = strip(raw);
    if (!/[/~]|^\$\{?HOME/.test(tok) && tok !== "..") continue;
    out.push({ path: resolve(cwd, globBase(expandHome(tok, home))), recursive: false });
  }
  return out;
};

const targetsFor = (tool: string, input: Record<string, unknown>, cwd: string, home: string): Target[] => {
  const str = (k: string): string | undefined => (typeof input[k] === "string" ? input[k] : undefined);
  if (tool === "Read") {
    const f = str("file_path");
    return f === undefined ? [] : [{ path: resolve(cwd, expandHome(f, home)), recursive: false }];
  }
  if (tool === "Grep" || tool === "Glob") {
    const p = str("path");
    const out: Target[] = [{ path: resolve(cwd, expandHome(p ?? cwd, home)), recursive: true }];
    const pat = tool === "Glob" ? str("pattern") : undefined;
    if (pat !== undefined && /^(?:\/|~)/.test(pat)) {
      out.push({ path: resolve(cwd, globBase(expandHome(pat, home))), recursive: true });
    }
    return out;
  }
  if (tool === "Bash") {
    const c = str("command");
    return c === undefined ? [] : bashTargets(c, cwd, home);
  }
  return [];
};

const decide = (decision: "ask" | "deny", reason: string): string =>
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  })}\n`;

export const run = (d: Deps): number => {
  const setting = d.env["READ_GUARD"];
  if (setting === "off") return 0;
  const decision = setting === "deny" ? "deny" : "ask";

  let tool: unknown;
  let input: Record<string, unknown> | undefined;
  let cwd: unknown;
  try {
    const parsed = asObject(JSON.parse(d.stdin));
    tool = parsed?.["tool_name"];
    input = asObject(parsed?.["tool_input"]);
    cwd = parsed?.["cwd"];
  } catch {
    return 0;
  }
  if (typeof tool !== "string" || input === undefined) return 0;

  const configPath = d.env["READ_GUARD_CONFIG"] ?? `${d.home}/.claude/read-guard.json`;
  const text = d.readFile(configPath);
  if (text === undefined) return 0; // no config, nothing protected
  let listed: unknown;
  try {
    listed = asObject(JSON.parse(text))?.["directories"];
  } catch {
    listed = undefined;
  }
  if (!Array.isArray(listed) || !listed.every((x) => typeof x === "string")) {
    // A broken config must not silently disable the gate.
    d.out(decide("ask", `${configPath} is not valid (expected {"directories": ["/abs/or/~/dir"]}). Fix it; asking until then.`));
    return 0;
  }
  const base = typeof cwd === "string" && cwd.startsWith("/") ? cwd : d.home;
  const protectedDirs = listed
    .filter((x) => x !== "")
    .map((x) => resolve(base, expandHome(x, d.home)))
    .flatMap((x) => [...new Set(forms(x))]);

  for (const t of targetsFor(tool, input, base, d.home)) {
    for (const p of forms(t.path)) {
      const hit = protectedDirs.find((dir) => inside(p, dir) || (t.recursive && inside(dir, p)));
      if (hit === undefined) continue;
      d.out(
        decide(
          decision,
          `${tool} would read ${p}, inside protected directory ${hit} (read-guard). ` +
            `Allow once by approving this prompt; remove the directory from ${configPath} or set READ_GUARD=off to stop guarding.`,
        ),
      );
      return 0;
    }
  }
  return 0;
};

if (import.meta.main) {
  try {
    process.exitCode = run({
      env: process.env,
      stdin: readFileSync(0, "utf8"),
      home: homedir(),
      readFile: (p) => {
        try {
          return readFileSync(p, "utf8");
        } catch {
          return undefined;
        }
      },
      out: (t) => process.stdout.write(t),
    });
  } catch {
    // An internal crash must not read as "no opinion" for a security gate.
    process.stdout.write(decide("ask", "read-guard crashed internally; asking instead of guessing."));
    process.exitCode = 0;
  }
}
