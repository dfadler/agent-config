import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL019: `tool_used` with `max` below 1 and no explicit `min: 0`. `min`
 * defaults to 1, so the grader needs at least one call and at most none, and
 * can never pass (seen as `expected 1..0` in the #450 run).
 */
export const rule: Rule = {
  id: "EVAL019",
  severity: "error",
  title: "tool_used with max below 1 needs an explicit min: 0",
  source: `observed in a logged-in run on #450, not in the docs; the default of min comes from ${fromDocs("tool_used min and max")}`,
  checkCase: (c, { schema }) => {
    const spec = schema.graderTypes
      .find((t) => t.type === "tool_used")
      ?.keys.find((k) => k.name === "min");
    const minDefault = String(spec?.default ?? 1);
    return c.graders.flatMap((g) => {
      if (g.type !== "tool_used" || g.max.value === undefined) return [];
      // Fine when the range is satisfiable. An explicit min of 0 is the
      // intended "never called" check, and also lands here.
      if (g.max.value >= g.min.value) return [];
      const how = g.min.explicit
        ? `has min: ${String(g.min.value)}`
        : `has no min, which defaults to ${minDefault}`;
      return [
        {
          message: `${graderLabel(g)} (tool_used '${g.tool.value}') sets max: ${String(g.max.value)} but ${how}, so it expects ${String(g.min.value)}..${String(g.max.value)} calls and can never pass.`,
          fix: `To check the tool is never called, add \`min: 0\` next to \`max: ${String(g.max.value)}\`. Otherwise raise max to at least min.`,
          loc: g.max.loc,
        },
      ];
    });
  },
};
