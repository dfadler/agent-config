import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/** EVAL001: a case with no grader fails to load. */
export const rule: Rule = {
  id: "EVAL001",
  severity: "error",
  title: "Case has at least one grader",
  source: fromDocs("a case without a grader fails to load"),
  checkCase: (c, { schema }) =>
    c.graders.length > 0
      ? []
      : [
          {
            message: `Case '${c.name.value}' has no grader, so it fails to load.`,
            fix: `Add a grader: a \`graders:\` entry in case.yaml, or a graders/<name>.md file with \`type:\` set to one of ${schema.graderTypes.map((t) => t.type).join(", ")}. Prefer a free grader (regex, tool_used, tool_order, file_exists) before llm.`,
            loc: {
              file: c.promptFile ?? c.caseYamlFile ?? c.dir,
              line: 1,
            },
          },
        ],
};
