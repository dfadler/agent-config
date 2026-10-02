/**
 * JSON-in/JSON-out entry point for the sync logic, so skills call this instead
 * of reimplementing any of it. Input text in, result out; the only code that
 * touches the process is in `bin.ts`.
 *
 * Exit codes follow the repo's shell taxonomy: 0 ok, 1 the check ran and
 * found something wrong, 2 usage error.
 */

import { hashText } from "./hash.ts";
import { ManifestError, parseEntry, snapshotFile, bodyHash } from "./manifest.ts";
import { normalizeLocal, normalizeRemote } from "./normalize.ts";
import { applyPlan, planFile } from "./plan.ts";
import { ReadError } from "./slack-read.ts";
import {
  SyncError,
  planPush,
  pullStep,
  readFingerprint,
  recordStep,
  scan,
} from "./sync-fs.ts";
import { validate } from "./validate.ts";

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const USAGE = `Usage: bin.ts <command> [options] < input

Pure commands (input on stdin, JSON result on stdout):
  normalize --side local|remote   markdown -> title, sections, hashes
  validate                        markdown -> canvas-rule issues (exit 1 on errors)
  plan                            {entry, local, remote, canvas_id?, section_ids?}
                                  -> status, chunks, canvas edits, new local
                                  content, conflicts, and the next manifest entry
  fingerprint                     slack_read_canvas result -> change fingerprint

Sync-root commands (--root DIR is the sync root; stdin is a slack_read_canvas
result unless noted):
  scan --root DIR                 files, their state, missing files, pending deletions
  plan-push --root DIR --path P   plan pushing one file; empty stdin = no canvas yet.
                                  Never writes.
  record --root DIR --path P --after push|pull
                                  record a finished step from a fresh read
  pull --root DIR --path P [--apply]
                                  take canvas-only changes into the file; without
                                  --apply it only reports

  -h, --help                      show this message
`;

function fail(message: string, code = EXIT_USAGE): CliResult {
  return { code, stdout: "", stderr: `${message}\n` };
}

function ok(value: unknown, code = EXIT_OK): CliResult {
  return { code, stdout: `${JSON.stringify(value, null, 2)}\n`, stderr: "" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string") throw new TypeError(`"${key}" must be a string`);
  return value;
}

/** Parse `--key value` pairs and bare boolean flags. */
function parseFlags(
  args: string[],
  valued: readonly string[],
  boolean: readonly string[],
): Map<string, string | true> | string {
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    const name = arg.replace(/^--/, "");
    if (!arg.startsWith("--")) return `unexpected argument "${arg}"`;
    if (boolean.includes(name)) {
      flags.set(name, true);
    } else if (valued.includes(name)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) return `--${name} needs a value`;
      flags.set(name, value);
      i += 1;
    } else {
      return `unknown option "${arg}"`;
    }
  }
  return flags;
}

function flag(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function runPlan(stdin: string, now: string): CliResult {
  const parsed = parseJson(stdin);
  if (parsed === null) return fail("plan: stdin is not valid JSON");
  const input = parsed.value;
  if (!isRecord(input)) return fail("plan: stdin must be a JSON object");

  const entry = input["entry"];
  const base = entry === null || entry === undefined ? null : parseEntry(entry, "entry");
  const local = normalizeLocal(requireString(input, "local"));
  const remote = normalizeRemote(requireString(input, "remote"));

  const plan = planFile(base, local, remote);
  const applied = applyPlan(plan, local, remote);
  const blocked = applied.conflicts.length > 0 || applied.titleConflict !== null;

  const canvasId = input["canvas_id"];
  const sectionIds = input["section_ids"];
  const next =
    blocked || typeof canvasId !== "string"
      ? null
      : snapshotFile({
          canvasId,
          title: applied.local.title,
          sections: applied.local.sections,
          sectionIds: Array.isArray(sectionIds)
            ? sectionIds.map((id: unknown) => (typeof id === "string" ? id : undefined))
            : [],
          now,
        });

  return ok({
    status: plan.status,
    title: plan.title,
    chunks: plan.chunks,
    ops: applied.ops,
    local: { title: applied.local.title, body: applied.local.body },
    conflicts: applied.conflicts,
    title_conflict: applied.titleConflict,
    entry: next,
  });
}

function runRootCommand(command: string, rest: string[], stdin: string, now: string): CliResult {
  const parsed = parseFlags(
    rest,
    ["root", "path", "after"],
    command === "pull" ? ["apply"] : [],
  );
  if (typeof parsed === "string") return fail(`${command}: ${parsed}`);
  const root = flag(parsed, "root");
  if (root === undefined) return fail(`${command}: --root is required`);

  if (command === "scan") return ok(scan(root));

  const path = flag(parsed, "path");
  if (path === undefined) return fail(`${command}: --path is required`);

  const read = stdin.trim() === "" ? null : parseJson(stdin);
  if (stdin.trim() !== "" && read === null) return fail(`${command}: stdin is not valid JSON`);
  const readValue = read === null ? null : read.value;

  if (command === "plan-push") {
    const result = planPush(root, path, readValue);
    return ok(result, result.blocked === null ? EXIT_OK : EXIT_FAILURE);
  }

  if (readValue === null) return fail(`${command}: a slack_read_canvas result is required on stdin`);

  if (command === "record") {
    const after = flag(parsed, "after");
    if (after !== "push" && after !== "pull") return fail("record: --after push|pull is required");
    const result = recordStep(root, path, readValue, after, now);
    return ok(result, result.recorded ? EXIT_OK : EXIT_FAILURE);
  }

  const result = pullStep(root, path, readValue, parsed.get("apply") === true, now);
  return ok(result, result.blocked === null ? EXIT_OK : EXIT_FAILURE);
}

/** Run one command. `now` is injected so results stay deterministic. */
export function run(argv: string[], stdin: string, now: string): CliResult {
  const [command, ...rest] = argv;
  if (command === undefined || command === "-h" || command === "--help") {
    return { code: EXIT_OK, stdout: USAGE, stderr: "" };
  }

  try {
    if (command === "normalize") {
      const side = rest[0] === "--side" ? rest[1] : undefined;
      if (side !== "local" && side !== "remote") {
        return fail("normalize: --side local|remote is required");
      }
      const result = side === "local" ? normalizeLocal(stdin) : normalizeRemote(stdin);
      return ok({
        title: result.title,
        sections: result.sections,
        hashes: result.sections.map(hashText),
        body_hash: bodyHash(result.sections),
      });
    }
    if (command === "validate") {
      const issues = validate(stdin);
      const hasError = issues.some((issue) => issue.severity === "error");
      return ok({ ok: !hasError, issues }, hasError ? EXIT_FAILURE : EXIT_OK);
    }
    if (command === "plan") return runPlan(stdin, now);
    if (command === "fingerprint") {
      const parsed = parseJson(stdin);
      if (parsed === null) return fail("fingerprint: stdin is not valid JSON");
      return ok({ fingerprint: readFingerprint(parsed.value) });
    }
    if (
      command === "scan" ||
      command === "plan-push" ||
      command === "record" ||
      command === "pull"
    ) {
      return runRootCommand(command, rest, stdin, now);
    }
  } catch (error) {
    if (
      error instanceof SyncError ||
      error instanceof ReadError ||
      error instanceof ManifestError ||
      error instanceof TypeError
    ) {
      return fail(`${command}: ${error.message}`, EXIT_FAILURE);
    }
    throw error;
  }
  return fail(`unknown command "${command}"\n\n${USAGE}`);
}
