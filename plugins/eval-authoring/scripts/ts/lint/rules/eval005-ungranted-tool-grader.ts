import { grantsForCase } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/**
 * EVAL005: a `max: 0` `tool_used` grader on a withheld tool the case is not
 * granted can never fail, so it checks nothing. The `min >= 1` mirror (can
 * never pass) is not repeated here: on CLI 2.1.300, free `--max-cost-usd 0`
 * probes (#811) showed the preflight warns "cannot pass with the granted
 * tools" for any `tool_used` grader with `min >= 1` (explicit or the default)
 * on a withheld tool with no `--allow-tools` grant, in both case layouts,
 * whether or not the tool is in `allowed_tools`. It is a warning: the run
 * still launches.
 */
export const rule: Rule = {
  id: "EVAL005",
  severity: "error",
  title:
    "tool_used with max 0 on a withheld tool that is not granted to the case (can never fail)",
  source: `${fromDocs("Grant tools")}; the CLI's preflight warning 'cannot pass with the granted tools' covers min >= 1 on an ungranted tool (probed on 2.1.300, #811)`,
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
      const max = g.max.value;
      // max below an unsatisfiable min is EVAL019's finding; reporting it here too would double up.
      if (max === undefined || max >= 1 || max < g.min.value) return [];
      return [
        {
          message: `${graderLabel(g)} requires ${tool} to be used at most ${String(max)} times, but ${tool} is not granted to case '${c.name.value}', so the run withholds it and the check can never fail.`,
          fix: `Record a ${tool} grant for '${c.name.value}' in evals/grants.yaml, or replace the grader with one that does not depend on ${tool}.`,
          loc: g.tool.loc,
        },
      ];
    });
  },
};
