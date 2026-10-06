import { grantsForCase } from "../../parser/index.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/** EVAL004: a withheld tool in `allowed_tools` needs a recorded grant for that case. */
export const rule: Rule = {
  id: "EVAL004",
  severity: "error",
  title:
    "allowed_tools lists Bash, Write, Edit, WebFetch or WebSearch with no recorded grant for the case",
  source: fromDocs("Grant tools"),
  checkCase: (c, { schema, grants }) => {
    const granted = new Set(
      grantsForCase(grants, c.name.value).map((g) => g.tool),
    );
    return c.allowedTools.value
      .filter(
        (t) =>
          schema.toolsNeedingGrant.includes(t.tool) && !granted.has(t.tool),
      )
      .map((t) => ({
        message: `Case '${c.name.value}' lists '${t.raw}' in allowed_tools, but allowed_tools cannot grant ${t.tool} and the grants file records no ${t.tool} grant for this case.`,
        fix: `Add "${t.raw}" under grants.${c.name.value} in evals/grants.yaml (the run is then started with --allow-tools), or remove it from allowed_tools.`,
        loc: t.loc,
      }));
  },
};
