import { grantsForCase } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/** EVAL005: a `tool_used` grader on a withheld tool the case is not granted can never behave as written. */
export const rule: Rule = {
  id: "EVAL005",
  severity: "error",
  title:
    "tool_used grader on a withheld tool that is not granted to the case (max 0 never fails, min 1 never passes)",
  source: fromDocs(
    "Grant tools; also the CLI's preflight warning 'cannot pass with the granted tools'",
  ),
  checkCase: (c, { schema, grants }) => {
    const granted = new Set(
      grantsForCase(grants, c.name.value).map((g) => g.tool),
    );
    return c.graders.flatMap((g): readonly Problem[] => {
      if (g.type !== "tool_used") return [];
      const tool = g.tool.value;
      if (!schema.toolsNeedingGrant.includes(tool) || granted.has(tool)) {
        return [];
      }
      const fix = `Record a ${tool} grant for '${c.name.value}' in evals/grants.yaml, or replace the grader with one that does not depend on ${tool}.`;
      const max = g.max.value;
      if (max !== undefined && max < 1) {
        return [
          {
            message: `${graderLabel(g)} requires ${tool} to be used at most ${String(max)} times, but ${tool} is not granted to case '${c.name.value}', so the run withholds it and the check can never fail.`,
            fix,
            loc: g.tool.loc,
          },
        ];
      }
      return g.min.value >= 1
        ? [
            {
              message: `${graderLabel(g)} requires ${tool} to be used at least ${String(g.min.value)} time(s), but ${tool} is not granted to case '${c.name.value}', so the run withholds it and the grader cannot pass.`,
              fix,
              loc: g.tool.loc,
            },
          ]
        : [];
    });
  },
};
