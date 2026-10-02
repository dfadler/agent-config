/**
 * Reader for the grants file (`evals/grants.yaml`), the format defined in
 * `docs/grants-format.md`: `schema_version: "1"` and `grants: {case: [entry]}`.
 */
import { readFileSync } from "node:fs";
import { getSchema } from "./schema.ts";
import { parseAllowedTool } from "./tools.ts";
import type {
  AllowedTool,
  GrantEntry,
  GrantsFile,
  ParseIssue,
  SourceLoc,
} from "./types.ts";
import { parseYaml, type YNode } from "./yaml.ts";

/** The `schema_version` the grants format supports. */
export const GRANTS_SCHEMA_VERSION = "1";

const emptyGrants: GrantsFile = { file: undefined, entries: [], issues: [] };

const errnoCode = (e: unknown): string | undefined =>
  typeof e === "object" && e !== null && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;

/**
 * Read the grants file at `file`. A missing file gives an empty `GrantsFile`
 * with `file: undefined` (every case then has no grants). Used by EVAL004,
 * EVAL005, the wrapper and the hook. Whether each entry names a real case is
 * checked by `checkGrantCaseNames`, because only the caller knows the cases.
 */
export const readGrantsFile = (file: string): GrantsFile => {
  const loc = (node: { line: number; column: number }): SourceLoc => ({
    file,
    line: node.line,
    column: node.column,
  });
  const text = ((): string | GrantsFile => {
    try {
      return readFileSync(file, "utf8");
    } catch (e) {
      if (errnoCode(e) === "ENOENT") return emptyGrants;
      return {
        file,
        entries: [],
        issues: [
          {
            kind: "unreadable-file",
            message: `cannot read grants file: ${e instanceof Error ? e.message : String(e)}`,
            loc: { file, line: 1 },
          },
        ],
      };
    }
  })();
  if (typeof text !== "string") return text;

  const issues: ParseIssue[] = [];
  const issue = (
    kind: ParseIssue["kind"],
    message: string,
    at: { line: number; column: number },
  ): void => {
    issues.push({ kind, message, loc: loc(at) });
  };

  const parsed = parseYaml(text);
  if (!parsed.ok) {
    issue("yaml-syntax", parsed.message, parsed);
    return { file, entries: [], issues };
  }
  const root: YNode | undefined = parsed.value;
  if (root?.kind !== "map") {
    issue(
      "wrong-type",
      "grants file must be a mapping with schema_version and grants",
      root ?? { line: 1, column: 1 },
    );
    return { file, entries: [], issues };
  }

  const allowed = new Set(["schema_version", "grants"]);
  root.entries
    .filter((e) => !allowed.has(e.key))
    .forEach((e) => {
      issue(
        "wrong-type",
        `unknown top-level key '${e.key}' (expected schema_version and grants)`,
        { line: e.keyLine, column: e.keyColumn },
      );
    });

  const version = root.entries.find((e) => e.key === "schema_version");
  if (version === undefined) {
    issue(
      "unsupported-schema",
      `missing schema_version (expected "${GRANTS_SCHEMA_VERSION}")`,
      root,
    );
  } else if (
    version.value.kind !== "scalar" ||
    version.value.text !== GRANTS_SCHEMA_VERSION
  ) {
    issue(
      "unsupported-schema",
      `unsupported schema_version (expected "${GRANTS_SCHEMA_VERSION}")`,
      { line: version.keyLine, column: version.keyColumn },
    );
  }

  const grantsEntry = root.entries.find((e) => e.key === "grants");
  if (grantsEntry === undefined) {
    issue("wrong-type", "missing 'grants' mapping", root);
    return { file, entries: [], issues };
  }
  const grantsNode = grantsEntry.value;
  if (grantsNode.kind !== "map") {
    issue("wrong-type", "'grants' must be a mapping of case name to a list", {
      line: grantsEntry.keyLine,
      column: grantsEntry.keyColumn,
    });
    return { file, entries: [], issues };
  }

  const shape = new RegExp(
    `^(${getSchema().toolsNeedingGrant.join("|")})(\\(.+\\))?$`,
  );
  const entries: readonly GrantEntry[] = grantsNode.entries.map((e) => {
    const caseNameLoc = loc({ line: e.keyLine, column: e.keyColumn });
    if (e.value.kind !== "seq") {
      issue("wrong-type", `grants for '${e.key}' must be a list of entries`, {
        line: e.keyLine,
        column: e.keyColumn,
      });
      return { caseName: e.key, caseNameLoc, grants: [] };
    }
    const seen = new Set<string>();
    const grants: readonly AllowedTool[] = e.value.items.flatMap((item) => {
      if (item.kind !== "scalar" || typeof item.value !== "string") {
        issue(
          "wrong-type",
          `grant entry for '${e.key}' must be a string`,
          item,
        );
        return [];
      }
      if (!shape.test(item.text)) {
        issue(
          "wrong-type",
          `invalid grant entry '${item.text}' for '${e.key}' (expected one of ${getSchema().toolsNeedingGrant.join(", ")}, optionally as Tool(specifier))`,
          item,
        );
        return [];
      }
      if (seen.has(item.text)) {
        issue(
          "wrong-type",
          `duplicate grant entry '${item.text}' for '${e.key}'`,
          item,
        );
        return [];
      }
      seen.add(item.text);
      return [parseAllowedTool(item.text, loc(item))];
    });
    return { caseName: e.key, caseNameLoc, grants };
  });
  return { file, entries, issues };
};

/**
 * Add an issue for every grants entry whose case does not exist (a stale entry
 * hides a renamed or deleted case). Separate from `readGrantsFile`, whose
 * signature takes only the file; call it once the case names are known.
 */
export const checkGrantCaseNames = (
  grants: GrantsFile,
  caseNames: readonly string[],
): GrantsFile => {
  const known = new Set(caseNames);
  const stale: readonly ParseIssue[] = grants.entries
    .filter((e) => !known.has(e.caseName))
    .map((e) => ({
      kind: "wrong-type",
      message: `grants entry '${e.caseName}' does not name an existing case`,
      loc: e.caseNameLoc,
    }));
  return stale.length === 0
    ? grants
    : { ...grants, issues: [...grants.issues, ...stale] };
};

/** The grants for one case; empty when it has no entry. Used by EVAL004, EVAL005. */
export const grantsForCase = (
  grants: GrantsFile,
  caseName: string,
): readonly AllowedTool[] =>
  grants.entries.find((e) => e.caseName === caseName)?.grants ?? [];

/**
 * A case's grant set: its entries as strings, de-duplicated and sorted. Two
 * cases have identical grants when their sets are equal; the run wrapper
 * groups on this (see `docs/grants-format.md`).
 */
export const grantSet = (
  grants: GrantsFile,
  caseName: string,
): readonly string[] =>
  [...new Set(grantsForCase(grants, caseName).map((g) => g.raw))].sort();
