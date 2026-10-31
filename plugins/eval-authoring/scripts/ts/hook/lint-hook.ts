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
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveEvalDir } from "../parser/index.ts";
import type { Finding } from "../lint/types.ts";
import type { LintOutcome, LintReport } from "../lint/runner.ts";

/** Tools whose edits we lint. `MultiEdit` is not in the hook matcher but is the same shape. */
const EDIT_TOOLS: readonly string[] = ["Write", "Edit", "MultiEdit"];

/** Keep the injected context small; the full report is one lint run away. */
const MAX_CONTEXT_CHARS = 8000;

/** Under the 60s harness timeout in hooks.json, so a slow lint gets a message instead of a silent kill. */
const LINT_DEADLINE_MS = 45_000;

/** Runs the lint for a plugin root. Injected so tests can simulate a crash. */
export type LintFn = (
  pluginRoot: string,
  signal?: AbortSignal,
) => Promise<LintOutcome>;

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
  // Relative paths are relative to the plugin root, not the hook's cwd.
  // Suite-level findings (grants, manifest, mocks) sit outside every case dir.
  return report.findings.filter((f) => {
    const abs = resolve(report.pluginRoot, f.loc.file);
    if (abs.startsWith(caseDir + sep)) return true;
    const rel = relative(scope.evalDir, abs);
    const other = isOutside(rel) ? undefined : rel.split(sep);
    // Drop only findings inside some other case dir.
    return !(
      other !== undefined &&
      other.length > 1 &&
      isCaseDir(join(scope.evalDir, other[0] ?? ""))
    );
  });
};

/** The stdout JSON that makes `context` visible to Claude. */
export const hookOutput = (context: string): string =>
  `${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: context,
    },
  })}\n`;

const isOutcome = (v: unknown): v is LintOutcome =>
  isRecord(v) && typeof v["ok"] === "boolean";

/**
 * Run the lint in a child process so synchronous lint work cannot block the
 * parent's deadline timer. Aborting `signal` SIGKILLs the child. A process, not
 * a worker thread: terminating a blocked worker thread crashed the vitest soak
 * with SIGSEGV/SIGTRAP (#830, #871), and Node documents that execution "may
 * stop at any point" on `worker.terminate()`
 * (https://nodejs.org/api/worker_threads.html). The child (and the rules) load
 * only when this is called, so a no-op edit never pays.
 */
export const childLint = (
  pluginRoot: string,
  signal?: AbortSignal,
  childUrl: URL = new URL("./lint-child.ts", import.meta.url),
): Promise<LintOutcome> =>
  new Promise((resolveOutcome, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(childUrl), pluginRoot], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const out: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    const stop = (): void => {
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", stop, { once: true });
    child.once("error", (e) => {
      signal?.removeEventListener("abort", stop);
      reject(e);
    });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", stop);
      try {
        if (code !== 0) throw new Error("nonzero exit");
        const outcome: unknown = JSON.parse(Buffer.concat(out).toString("utf8"));
        if (!isOutcome(outcome)) throw new Error("not a lint outcome");
        resolveOutcome(outcome);
      } catch {
        reject(new Error("lint process exited without a result"));
      }
    });
    // Already aborted before the listener existed: kill straight away.
    if (signal?.aborted === true) stop();
  });

/** The default lint: runs in a child process so the parent can enforce the deadline. */
export const defaultLint: LintFn = (pluginRoot, signal) =>
  childLint(pluginRoot, signal);

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
  deadlineMs: number = LINT_DEADLINE_MS,
): Promise<string> => {
  const edited = parseInput(raw);
  if (edited === undefined) return "";
  const scope = scopeOf(edited.filePath);
  if (scope === undefined) return "";
  try {
    let timer: NodeJS.Timeout | undefined;
    const abort = new AbortController();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error(`lint exceeded ${String(deadlineMs)}ms; skipped`));
      }, deadlineMs);
    });
    const outcome = await Promise.race([lint(scope.pluginRoot, abort.signal), deadline]).finally(
      () => {
        clearTimeout(timer);
        abort.abort();
      },
    );
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
