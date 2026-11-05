/**
 * Scanner behind the pii-cleanup skill (#988, from #958): personal data in tracked files. This
 * repo is public.
 *
 *   node check-pii.ts [PATHSPEC...]    default: plugins/*\/evals/**, tracked files only
 *
 * Fails on a non-reserved email, a home directory that is not a placeholder, and any deny term
 * in the PII_DENY_TERMS environment variable (one per line, set by the owner for the run, so the
 * terms are never committed). The patterns are redact.ts's, narrowed to what names a person. A report
 * holds file, line and rule only, never the matched value or a deny term.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findPersonalData } from "./redact.ts";

// `top` anchors the pathspec at the repository root; without it git matches relative to the cwd.
const DEFAULT_PATHSPEC = ":(top,glob)plugins/*/evals/**";

const USAGE = `Usage: check-pii.ts [-h|--help] [PATHSPEC...]

Fail when a tracked file matching a git pathspec (default ${DEFAULT_PATHSPEC})
holds a non-reserved email, a /Users/<name> or /home/<name> path whose name is not a
placeholder (jdoe, jroe, me, user), or a deny term. Deny terms come from PII_DENY_TERMS,
one per line; without it only the patterns run.
Prints file:line: rule. Never prints a matched value or a deny term.
A tracked file that cannot be read (deleted from the working tree) is listed as unreadable and
makes the scan incomplete.
Exit codes: 0 clean, 1 personal data found or scan incomplete, 2 bad arguments or no file matched.
`;

const trackedFiles = (pathspecs: readonly string[]): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", ...pathspecs], { encoding: "utf8" })
    .split("\0")
    .filter((f) => f !== "");

const HISTORY = "git history is not scanned or changed";

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  out: (s: string) => void,
  listFiles: (pathspecs: readonly string[]) => readonly string[] = trackedFiles,
  read: (file: string) => string = (f) => readFileSync(f, "utf8"),
): number {
  if (argv.includes("-h") || argv.includes("--help")) {
    out(USAGE);
    return 0;
  }
  const specs = argv.length > 0 ? argv : [DEFAULT_PATHSPEC];
  const deny = (env["PII_DENY_TERMS"] ?? "")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => t !== "");
  const files = listFiles(specs);
  if (files.length === 0) {
    out("no files matched; refusing to pass on an empty set");
    return 2;
  }
  let hits = 0;
  let bad = 0;
  let unreadable = 0;
  for (const f of files) {
    let text: string;
    try {
      text = read(f);
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
