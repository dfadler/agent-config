/**
 * Scanner behind the pii-cleanup skill and the repo's opt-in pre-commit hook (#988, from #958):
 * personal data in tracked files. This repo is public.
 *
 *   node check-pii.ts [PATHSPEC...]            default: plugins/*\/evals/**, tracked files
 *   node check-pii.ts --staged [PATHSPEC...]   only files staged for commit, read from the index
 *
 * Fails on a non-reserved email, a home directory that is not a placeholder, and any deny term
 * in the PII_DENY_TERMS environment variable (one per line, set by the owner for the run, so the
 * terms are never committed). A report holds file, line and rule only, never the matched value
 * or a deny term.
 *
 * Self-contained on purpose: the rules are the person-naming subset of the mine-cases
 * redactor's, copied so this plugin imports nothing from another plugin.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";

// `top` anchors the pathspec at the repository root; without it git matches relative to the cwd.
const DEFAULT_PATHSPEC = ":(top,glob)plugins/*/evals/**";

// Quantifiers are bounded and no group repeats an ambiguous class, so a long single line stays linear.
const RULES: readonly (readonly [string, RegExp])[] = [
  ["email", /[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,10}/g],
  ["file-url", /\bfile:\/\/[^\s"'<>)]*/gi],
  ["windows-path", /\b[A-Za-z]:\\[\p{L}\p{M}\p{N}_ .-]+(?:\\[\p{L}\p{M}\p{N}_ .-]+)*/gu],
  ["abs-path", /(?<![\p{L}\p{M}\p{N}_.:/])(?:\/[\p{L}\p{M}\p{N}_.@+~-]+){2,}/gu],
  // Claude Code names a project directory after its path: `-Users-<name>-<dir>`.
  ["project-dir", /(?<!\w)-(?:Users|home)-[\w.-]{1,200}/g],
];

/** Names a committed case may use for a person on purpose (jroe is the invented user of the mine-cases fixtures). */
const PLACEHOLDER = /^(?:jdoe|jroe|me|user)$/i;
const RESERVED_EMAIL = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|test|invalid|example|localhost)$/i;

const isOwned = (name: string | undefined): boolean => name !== undefined && !PLACEHOLDER.test(name);
const owner = (re: RegExp, m: string): string | undefined => re.exec(m)?.[1];

/** Rule name to [reported rule, does this match name a person?]. Paths count only under /Users, /home or C:\Users. */
const PERSONAL: Readonly<Record<string, readonly [string, (m: string) => boolean]>> = {
  // The final label must be alphabetic: `pkg@1.2.3` (npx, lockfiles) is a version, not an address. `git@` is ssh.
  email: ["email", (m) => /\.[a-z]{2,}$/i.test(m) && !RESERVED_EMAIL.test(m) && !/^(?:git|jdoe|jroe|me|user)@/i.test(m)],
  "abs-path": ["home-dir", (m) => isOwned(owner(/^\/(?:Users|home)\/([^/]+)/, m))],
  "file-url": ["home-dir", (m) => isOwned(owner(/^file:\/\/\/(?:[A-Za-z]:\/)?(?:Users|home)\/([^/]+)/i, m))],
  "windows-path": ["home-dir", (m) => isOwned(owner(/^[A-Za-z]:\\Users\\([^\\]+)/i, m))],
  "project-dir": ["home-dir", (m) => isOwned(owner(/^-(?:Users|home)-([^-]+)/, m))],
};

/** A deny term as a regex; whitespace inside the term matches any run of whitespace, line breaks included. */
const denyRe = (term: string): RegExp =>
  new RegExp(
    term
      .trim()
      .split(/\s+/)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s+"),
    "gi",
  );

export type PiiHit = { readonly rule: string; readonly line: number };

/**
 * Where `text` holds personal data, as rule and 1-based line only: a hit never carries the matched
 * value, so a report cannot spread it. A deny term reports as `deny[N]` (its 1-based position) and
 * names the line where the match starts.
 */
export const findPersonalData = (text: string, deny: readonly string[] = []): PiiHit[] => {
  const lineOf = (index: number): number => text.slice(0, index).split("\n").length;
  const hits = new Map<string, PiiHit>();
  const add = (rule: string, index: number): void => {
    const line = lineOf(index);
    hits.set(`${rule}:${String(line)}`, { rule, line });
  };
  for (const [name, re] of RULES) {
    const personal = PERSONAL[name];
    if (personal === undefined) continue;
    for (const m of text.matchAll(new RegExp(re.source, re.flags))) if (personal[1](m[0])) add(personal[0], m.index);
  }
  deny.forEach((d, i) => {
    for (const m of text.matchAll(denyRe(d))) add(`deny[${String(i + 1)}]`, m.index);
  });
  return [...hits.values()].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
};

const USAGE = `Usage: check-pii.ts [-h|--help] [--staged] [PATHSPEC...]

Fail when a tracked file matching a git pathspec (default ${DEFAULT_PATHSPEC})
holds a non-reserved email, a /Users/<name> or /home/<name> path whose name is not a
placeholder (jdoe, jroe, me, user), or a deny term. Deny terms come from PII_DENY_TERMS,
one per line; without it only the patterns run.
--staged scans only the files staged for commit, as they are in the index; nothing staged
in scope passes.
Prints file:line: rule. Never prints a matched value or a deny term.
A tracked file that cannot be read (deleted from the working tree) is listed as unreadable and
makes the scan incomplete.
Exit codes: 0 clean, 1 personal data found or scan incomplete, 2 bad arguments or no file matched.
`;

const git = (args: readonly string[], cwd?: string): string =>
  execFileSync("git", [...args], { encoding: "utf8", ...(cwd === undefined ? {} : { cwd }) });

const nul = (s: string): string[] => s.split("\0").filter((f) => f !== "");

const trackedFiles = (pathspecs: readonly string[]): string[] => nul(git(["ls-files", "-z", "--", ...pathspecs]));

/** Files added, copied, modified or renamed in the index that match `pathspecs`. */
export const stagedFiles = (pathspecs: readonly string[], cwd?: string): string[] =>
  nul(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR", "--", ...pathspecs], cwd));

/** The staged blob of `file` (for a symlink, its link text). The working copy may differ. */
export const readStaged = (file: string, cwd?: string): string => git(["show", `:${file}`], cwd);

/**
 * What git tracks for `file`: its content, or for a symlink the link text, which is what git stores.
 * A link is never followed, so a target outside the repository is neither scanned nor opened.
 */
export const readTracked = (file: string): string =>
  lstatSync(file).isSymbolicLink() ? readlinkSync(file) : readFileSync(file, "utf8");

const HISTORY = "git history is not scanned or changed";

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (s: string) => void,
  listFiles?: (pathspecs: readonly string[]) => readonly string[],
  read?: (file: string) => string,
): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    out(USAGE);
    return 0;
  }
  const staged = argv.includes("--staged");
  const args = argv.filter((a) => a !== "--staged");
  const list = listFiles ?? (staged ? (s: readonly string[]) => stagedFiles(s) : trackedFiles);
  const readFile = read ?? (staged ? (f: string) => readStaged(f) : readTracked);
  const specs = args.length > 0 ? args : [DEFAULT_PATHSPEC];
  const deny = (env["PII_DENY_TERMS"] ?? "")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  const files = list(specs);
  if (files.length === 0) {
    if (staged) {
      out(`✓ no staged files in scope; ${HISTORY}`);
      return 0;
    }
    out("no files matched; refusing to pass on an empty set");
    return 2;
  }
  let hits = 0;
  let bad = 0;
  let unreadable = 0;
  for (const f of files) {
    let text: string;
    try {
      text = readFile(f);
    } catch {
      // A tracked file deleted from the working tree is still listed by git. Say so and go on.
      unreadable++;
      out(`${f}: unreadable`);
      continue;
    }
    const found = findPersonalData(text, deny);
    if (found.length === 0) continue;
    bad++;
    hits += found.length;
    for (const h of found) out(`${f}:${String(h.line)}: ${h.rule}`);
  }
  const used =
    deny.length === 0
      ? "PII_DENY_TERMS is not set: only the pattern rules ran"
      : `${plural(deny.length, "deny term")} checked`;
  const incomplete = unreadable > 0 ? `; scan incomplete: ${plural(unreadable, "file")} unreadable` : "";
  if (bad > 0 || unreadable > 0) {
    out(
      `${plural(hits, "hit")} in ${plural(bad, "file")} (of ${String(files.length)}); ${used}${incomplete}; ${HISTORY}`,
    );
    return 1;
  }
  out(`✓ no personal data in ${plural(files.length, "file")}; ${used}; ${HISTORY}`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2), process.env, console.log);
