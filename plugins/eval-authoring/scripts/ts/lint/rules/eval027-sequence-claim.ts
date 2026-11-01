import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/**
 * Phrases that say the criteria judge the order of tool calls. Kept tight on
 * purpose: a bare "after", "first" or "then" is too common ("look after",
 * "says X after reading"), so a before/after must be followed by an action verb.
 */
const ACTION = "(?:runs?|running|ran|executes?|executing|calls?|calling|invokes?|invoking|edits?|editing|writes?|writing|commits?|committing|pushe?s?|pushing|deletes?|deleting|installs?|installing)";
const SEQUENCE_PHRASES: readonly RegExp[] = [
  new RegExp(`\\b(?:before|after)\\s+(?:it\\s+|they\\s+|the\\s+\\w+\\s+)?${ACTION}\\b`, "i"),
  /\bprior to\b/i,
  /\bfollowed by\b/i,
  /\bonly after\b/i,
  /\bin that order\b/i,
  /\bfirst\b[^.\n]{0,80}\bthen\b/i,
];

/**
 * EVAL027: `llm` criteria that judge an order, with no `tool_order` or
 * `tool_used` grader (other than the unscored Skill indicator) in the case. A
 * judge reading the reply cannot see the order tools ran in. Heuristic, so
 * info; a `trace` or `mock_calls` focus is left alone because the judge sees the calls.
 */
export const rule: Rule = {
  id: "EVAL027",
  severity: "info",
  title: "llm criteria judge an order of steps with no tool_order or tool_used grader",
  source:
    "from the Eval Research doc: grade behavior with a trace grader, a judge on the reply cannot see the order tools ran in",
  checkCase: (c) => {
    const checksOrder = c.graders.some(
      (g) => g.type === "tool_order" || (g.type === "tool_used" && g.tool.value !== "Skill"),
    );
    if (checksOrder) return [];
    return c.graders.flatMap((g) => {
      if (g.type !== "llm") return [];
      if (g.focus.value.kind === "trace" || g.focus.value.kind === "mock_calls") return [];
      const hit = SEQUENCE_PHRASES.map((p) => p.exec(g.criteria.value)?.[0]).find((m) => m !== undefined);
      if (hit === undefined) return [];
      return [
        {
          message: `${graderLabel(g)} appears to judge an order ("${hit}", heuristic), but the case has no tool_order or tool_used grader, so nothing checks the order.`,
          fix: "Add a `tool_order` grader (before and after) or a `tool_used` grader with min and max, and keep the llm criterion for what the reply says. Ignore this if the criteria are not about the order of tool calls.",
          loc: g.criteria.loc,
        },
      ];
    });
  },
};
