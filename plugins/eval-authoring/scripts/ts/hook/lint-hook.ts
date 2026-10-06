/**
 * PostToolUse hook (#461): after Claude writes or edits a file under a plugin's
 * eval directory, run the lint and hand the findings back as context. Report
 * only: the hook always exits 0, because a PostToolUse hook cannot undo the
 * edit and a hook must never break a session.
 *
 * Contract (https://code.claude.com/docs/en/hooks): the event arrives as JSON
 * on stdin with `tool_name`, `cwd` and `tool_input.file_path`; stdout JSON of
 * the form `{ hookSpecificOutput: { hookEventName: "PostToolUse",
 * additionalContext } }` reaches Claude, whereas plain stdout on exit 0 goes
 * to the debug log only.
 *
 * It no-ops (no output) unless the edited file is under the eval directory of
 * the nearest enclosing plugin, and never under a `tests/` directory, where
 * deliberately bad fixtures live. Self-contained: a plugin ships on its own, so
 * this imports only from the plugin's own scripts.
 */
import { existsSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveEvalDir } from "../parser/index.ts";
import type { Finding } from "../lint/types.ts";
import type { LintOutcome, LintReport } from "../lint/runner.ts";

/** Tools whose edits we lint. `MultiEdit` is not in the hook matcher but is the same shape. */
const EDIT_TOOLS: readonly string[] = ["Write", "Edit", "MultiEdit"];

/** Keep the injected context small; the full report is one lint run away. */
const MAX_CONTEXT_CHARS = 8000;

/** Runs the lint for a plugin root. Injected so tests can simulate a crash. */
export type LintFn = (pluginRoot: string) => Promise<LintOutcome>;

export interface EditedFile {
  readonly filePath: string;
}

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null;

/** The edited file's absolute path, or undefined if this event is not a file edit we handle. */
export const parseInput = (raw: string): EditedFile | undefined => {
  try {
    const event: unknown = JSON.parse(raw);
    if (!isRecord(event)) return undefined;
    const tool = event["tool_name"];
    const input = event["tool_input"];
    if (typeof tool !== "string" || !EDIT_TOOLS.includes(tool)) {
      return undefined;
    }
    if (!isRecord(input) || typeof input["file_path"] !== "string") {
      return undefined;
    }
    const filePath = input["file_path"];
    if (filePath === "") return undefined;
    const cwd = typeof event["cwd"] === "string" ? event["cwd"] : process.cwd();
    return {
      filePath: isAbsolute(filePath) ? filePath : resolve(cwd, filePath),
    };
  } catch {
    return undefined;
  }
};

/** Nearest ancestor directory of `filePath` holding `.claude-plugin/plugin.json`. */
export const findPluginRoot = (filePath: string): string | undefined => {
  const walk = (dir: string): string | undefined => {
    if (existsSync(join(dir, ".claude-plugin", "plugin.json"))) return dir;
    const parent = dirname(dir);
    return parent === dir ? undefined : walk(parent);
  };
  return walk(dirname(filePath));
};

/** Where an edited file sits in a plugin's eval directory. */
export interface Scope {
  readonly pluginRoot: string;
  /** The eval directory, joined onto the plugin root. */
  readonly evalDir: string;
  /** First path segment under the eval directory, when the file is in a subdirectory. */
  readonly firstSegment: string | undefined;
}

const isOutside = (rel: string): boolean =>
  rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

/**
 * Decide whether `filePath` is in scope: inside the eval directory of its
 * plugin and not under any `tests/` directory. Undefined means no-op.
 */
export const scopeOf = (filePath: string): Scope | undefined => {
  const pluginRoot = findPluginRoot(filePath);
  if (pluginRoot === undefined) return undefined;
  if (relative(pluginRoot, filePath).split(sep).includes("tests")) {
    return undefined;
  }
  const resolved = resolveEvalDir(pluginRoot);
  if (!resolved.ok) return undefined;
  const evalDir = join(pluginRoot, resolved.dir);
  const fromEval = relative(evalDir, filePath);
  if (isOutside(fromEval)) return undefined;
  const segments = fromEval.split(sep);
  return {
    pluginRoot,
    evalDir,
    firstSegment: segments.length > 1 ? segments[0] : undefined,
  };
};

const isCaseDir = (dir: string): boolean =>
  existsSync(join(dir, "case.yaml")) || existsSync(join(dir, "prompt.md"));

/**
 * The findings relevant to this edit: for a file inside one case, that case's
 * findings only (so an old bad case elsewhere does not repeat on every edit);
 * for anything else under the eval directory (grants, mocks, shared fixtures),
 * all of them.
 */
export const relevantFindings = (
  report: LintReport,
  scope: Scope,
): readonly Finding[] => {
  if (scope.firstSegment === undefined) return report.findings;
  const caseDir = resolve(scope.evalDir, scope.firstSegment);
  if (!isCaseDir(caseDir)) return report.findings;
  return report.findings.filter((f) =>
    resolve(f.loc.file).startsWith(caseDir + sep),
  );
};

/** The stdout JSON that makes `context` visible to Claude. */
export const hookOutput = (context: string): string =>
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  })}\n`;

/** The default lint: load the real rules and run them. Imported lazily so a no-op edit never loads them. */
export const defaultLint: LintFn = async (pluginRoot) => {
  const { discoverRules } = await import("../lint/discover.ts");
  const { lintPlugin } = await import("../lint/runner.ts");
  const found = await discoverRules();
  if (!found.ok) throw new Error(found.message);
  return lintPlugin(pluginRoot, found.rules);
};

const truncate = (text: string): string =>
  text.length <= MAX_CONTEXT_CHARS
    ? text
    : `${text.slice(0, MAX_CONTEXT_CHARS)}\n[truncated; run the lint for the full report]\n`;

/**
 * The hook: stdin text in, stdout text out. An empty string means "say
 * nothing". Never throws: any failure is a no-op, so a broken lint, missing
 * file or bad config cannot fail the hook.
 */
export const runHook = async (
  raw: string,
  lint: LintFn = defaultLint,
): Promise<string> => {
  const edited = parseInput(raw);
  if (edited === undefined) return "";
  const scope = scopeOf(edited.filePath);
  if (scope === undefined) return "";
  try {
    const outcome = await lint(scope.pluginRoot);
    if (!outcome.ok) return "";
    const findings = relevantFindings(outcome.report, scope);
    if (findings.length === 0) return "";
    const { formatText } = await import("../lint/runner.ts");
    const text = formatText({ ...outcome.report, findings });
    return hookOutput(
      truncate(
        `eval-authoring lint ran after your edit of ${edited.filePath}. Report only: nothing was blocked. Fix what applies to the case you are writing.\n\n${text}`,
      ),
    );
  } catch (e) {
    writeSync(
      2,
      `eval-authoring lint hook: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return "";
  }
};

const readStdin = async (): Promise<string> => {
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(String(chunk));
  return chunks.join("");
};

if (import.meta.main) {
  try {
    writeSync(1, await runHook(await readStdin()));
  } catch {
    // Never fail the hook.
  }
  process.exit(0);
}
