import type { KeyOrigin } from "../../parser/index.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/** Where to tell the author a misplaced key belongs. */
const home = (origin: KeyOrigin): string => {
  switch (origin) {
    case "case.yaml:execution":
      return "under `execution:`";
    case "case.yaml:context":
      return "under `context:`";
    case "case.yaml":
      return "at the top level";
    case "prompt.md":
      return "in prompt.md frontmatter";
    case "grader":
      return "on a grader";
  }
};

/**
 * EVAL002: the shape of the case files. Keys on layout: `schema_version` and
 * `name` are required in case.yaml only, and `schemaVersion` is read only from
 * there, so a prompt.md-only case is not checked for them.
 */
export const rule: Rule = {
  id: "EVAL002",
  severity: "error",
  title:
    "Unknown prompt.md key; case.yaml missing schema_version or name; run fields at the top level",
  source: fromDocs("the case.yaml and prompt.md field tables"),
  checkCase: (c, { schema }) => {
    const unknownPromptKeys: readonly Problem[] = c.keys
      .filter((k) => k.origin === "prompt.md" && k.status === "unknown")
      .map((k) => ({
        message: `Unknown prompt.md frontmatter key '${k.name}'.`,
        fix: `Remove it or fix the spelling. Accepted keys: ${schema.promptMdKeys.map((s) => s.name).join(", ")}.`,
        loc: k.loc,
      }));

    const misplaced: readonly Problem[] = c.keys
      .filter((k) => k.status === "misplaced" && k.belongsUnder !== undefined)
      .map((k) => ({
        message: `'${k.name}' is ${home(k.origin)} in case.yaml, but it is read only ${home(k.belongsUnder ?? k.origin)}, so it is ignored.`,
        fix: `Move '${k.name}' ${home(k.belongsUnder ?? k.origin)}.`,
        loc: k.loc,
      }));

    const caseYamlFile = c.caseYamlFile;
    if (caseYamlFile === undefined) return [...unknownPromptKeys, ...misplaced];

    const wanted = schema.caseYamlSchemaVersion;
    const versionProblems: readonly Problem[] =
      c.schemaVersion.value === wanted
        ? []
        : [
            {
              message: c.schemaVersion.explicit
                ? `case.yaml has schema_version '${String(c.schemaVersion.value)}', not '${wanted}'.`
                : `case.yaml is missing schema_version '${wanted}'.`,
              fix: `Add \`schema_version: "${wanted}"\` at the top of case.yaml.`,
              loc: c.schemaVersion.loc,
            },
          ];

    const missingRequired: readonly Problem[] = schema.caseYamlTopLevelKeys
      .filter((s) => s.required && s.name !== "schema_version")
      .filter(
        (s) =>
          !c.keys.some((k) => k.origin === "case.yaml" && k.name === s.name),
      )
      .map((s) => ({
        message: `case.yaml is missing the required key '${s.name}'.`,
        fix: `Add \`${s.name}:\` at the top level of case.yaml.`,
        loc: { file: caseYamlFile, line: 1 },
      }));

    return [
      ...versionProblems,
      ...missingRequired,
      ...unknownPromptKeys,
      ...misplaced,
    ];
  },
};
