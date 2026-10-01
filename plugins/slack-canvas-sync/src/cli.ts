/**
 * JSON-in/JSON-out entry point for the sync logic, so skills can call it
 * instead of reimplementing any of it. Pure: input text in, result out. The
 * only process-touching code is in `bin.ts`.
 *
 * Exit codes follow the repo's shell taxonomy: 0 ok, 1 the check ran and
 * found something wrong, 2 usage error.
 */

import { hashText } from "../../../scripts/ts/hash.ts";
import { ManifestError, parseEntry, snapshotFile, bodyHash } from "./manifest.ts";
import { normalizeLocal, normalizeRemote } from "./normalize.ts";
import { applyPlan, planFile } from "./plan.ts";
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

Commands (input on stdin, JSON result on stdout):
  normalize --side local|remote   markdown -> title, sections, hashes
  validate                        markdown -> canvas-rule issues (exit 1 on errors)
  plan                            {entry, local, remote, canvas_id?, section_ids?}
                                  -> status, chunks, canvas edits, new local
                                  content, conflicts, and the next manifest entry

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

function runPlan(stdin: string, now: string): CliResult {
  let input: unknown;
  try {
    input = JSON.parse(stdin);
  } catch {
    return fail("plan: stdin is not valid JSON");
  }
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
  } catch (error) {
    if (error instanceof ManifestError || error instanceof TypeError) {
      return fail(`${command}: ${error.message}`, EXIT_FAILURE);
    }
    throw error;
  }
  return fail(`unknown command "${command}"\n\n${USAGE}`);
}
