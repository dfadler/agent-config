/**
 * Stop hook: when the work in this checkout changes a plugin's skills or
 * agents but not its evals, block the stop once and tell Claude to update the
 * cases and compare scores before and after. The omission is easy to make and
 * hard to notice, so this surfaces it at the moment the work would finish.
 *
 * Contract (https://code.claude.com/docs/en/hooks, Stop): stdin JSON carries
 * `cwd` and `stop_hook_active`; stdout `{ decision: "block", reason }` makes
 * Claude continue with `reason`. `stop_hook_active` is true on the retry, so
 * the hook blocks at most once per stop and never loops. Failures no-op.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { resolveEvalDir } from "../parser/index.ts";
import { findPluginRoot } from "./lint-hook.ts";

/** A hung git must not hold the Stop hook open; a timeout throws and the hook no-ops. 3 calls x 8s stays under the 30s hook timeout. */
const GIT_TIMEOUT_MS = 8_000;

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", [...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: GIT_TIMEOUT_MS,
  });

const lines = (s: string): string[] => s.split("\n").filter((l) => l !== "");

/**
 * Uncommitted (staged or not) plus untracked files, repo-relative. Committed
 * branch history is deliberately ignored: it is not this session's work, so a
 * read-only turn on a branch with older skill commits is never blocked.
 */
export const changedFiles = (cwd: string): readonly string[] => [
  ...lines(git(cwd, ["diff", "--name-only", "HEAD"])),
  ...lines(git(cwd, ["ls-files", "--others", "--exclude-standard"])),
];

const latestResults = (evalDir: string): string | undefined => {
  const dir = join(evalDir, "results");
  return existsSync(dir) ? readdirSync(dir).sort().at(-1) : undefined;
};

export interface Gap {
  readonly plugin: string;
  readonly changed: readonly string[];
  /** Newest results directory under the eval directory: the "before" score. */
  readonly baseline: string | undefined;
}

/** Plugins that already have an eval directory whose skills or agents changed while nothing under it did. */
export const findGaps = (
  top: string,
  files: readonly string[],
): readonly Gap[] => {
  const byPlugin = new Map<string, string[]>();
  for (const f of files) {
    const abs = resolve(top, f);
    const root = findPluginRoot(abs);
    if (root === undefined) continue;
    byPlugin.set(root, [...(byPlugin.get(root) ?? []), relative(root, abs)]);
  }
  return [...byPlugin].flatMap(([root, rel]) => {
    const resolved = resolveEvalDir(root);
    const evalRel = resolved.ok ? resolved.dir : "evals";
    if (!existsSync(join(root, evalRel))) return [];
    const inEvals = (p: string): boolean =>
      p === evalRel || p.startsWith(evalRel + sep);
    const changed = rel.filter(
      (p) => /^(skills|agents)\//.test(p) && !p.split(sep).includes("tests"),
    );
    if (changed.length === 0 || rel.some(inEvals)) return [];
    return [
      {
        plugin: relative(top, root),
        changed,
        baseline: latestResults(join(root, evalRel)),
      },
    ];
  });
};

export const reasonFor = (gaps: readonly Gap[]): string =>
  [
    "Eval check: you changed a plugin's skills or agents and no eval case changed with them.",
    ...gaps.map(
      (g) =>
        `- ${g.plugin}: changed ${g.changed.join(", ")}. Baseline (before) results: ${g.baseline ?? "none recorded yet"}.`,
    ),
    "Before you finish:",
    "1. Add or update cases that cover the change (load the author-cases skill) and lint them.",
    "2. Get the after score and compare it with the baseline: check `claude auth status`, then run `run-evals` if you are logged in and the user asked for a run; otherwise hand the user the run command.",
    "3. Put the results in the PR's 'Eval results' section and flag any drop in delta or pass rate.",
    "If evals genuinely do not apply (docs-only, typo, no behavior change), say so in one line in your final reply and stop.",
  ].join("\n");

const readStdin = async (): Promise<string> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
};

export const runStopHook = (raw: string): string => {
  try {
    const event: unknown = JSON.parse(raw);
    if (typeof event !== "object" || event === null) return "";
    if ("stop_hook_active" in event && event.stop_hook_active === true) {
      return "";
    }
    const cwd =
      "cwd" in event && typeof event.cwd === "string"
        ? event.cwd
        : process.cwd();
    const top = git(cwd, [
      "rev-parse",
      "--show-toplevel",
    ]).trim();
    const gaps = findGaps(top, changedFiles(top));
    return gaps.length === 0
      ? ""
      : `${JSON.stringify({ decision: "block", reason: reasonFor(gaps) })}\n`;
  } catch {
    return "";
  }
};

if (import.meta.main) {
  process.stdout.write(runStopHook(await readStdin()));
  process.exit(0);
}
