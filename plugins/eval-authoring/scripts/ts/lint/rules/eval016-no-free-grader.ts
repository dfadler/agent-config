import type { Rule } from "../types.ts";

/** Computed from the transcript and files, no model call, same answer every time. */
const FREE: ReadonlySet<string> = new Set([
  "regex",
  "tool_used",
  "tool_order",
  "file_exists",
]);
/** Cost a model call per run and add judge variance. */
const PAID: ReadonlySet<string> = new Set(["llm", "baseline"]);

/** EVAL016: a case with only paid graders. */
export const rule: Rule = {
  id: "EVAL016",
  severity: "warn",
  title: "Case has at least one free grader",
  source:
    "from #473: free graders (regex, tool_used, tool_order, file_exists) first, paid graders (llm, baseline) only when the property is semantic",
  checkCase: (c) => {
    const paid = c.graders.filter((g) => PAID.has(g.type));
    const hasFree = c.graders.some((g) => FREE.has(g.type));
    // No grader at all is EVAL001's finding; unknown types are EVAL003's.
    if (hasFree || paid.length === 0) return [];
    const types = [...new Set(paid.map((g) => g.type))].join(" and ");
    return [
      {
        message: `Case '${c.name.value}' has only ${types} graders and no free grader (from #473).`,
        fix: "Add a free grader that pins what must be true: regex on last_message or a file, tool_used or tool_order for steps, or file_exists. Keep the paid grader only for the semantic part, with a one-line comment saying why.",
        loc: paid[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
