import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/**
 * Phrases that say the criteria judge what a tool was called with. Kept
 * narrow on purpose: a bare "input" or "argument" is not enough, because a
 * criterion can talk about the user's input without judging a tool call.
 */
const TOOL_INPUT_PHRASES: readonly RegExp[] = [
  /\b(?:called|invoked|run|ran|executed)\s+with\b/i,
  /\btool\s+(?:input|argument|parameter|param)s?\b/i,
  /\b(?:input|argument|parameter|param)s?\s+(?:passed|sent|given)\s+to\b/i,
  /\b(?:tool|command)(?:'s|s')?\s+(?:input|argument|parameter)s?\b/i,
  /\bwith\s+the\s+(?:input|argument|parameter)s?\b/i,
];

/**
 * EVAL011: criteria that assert tool inputs belong on `focus: mock_calls`.
 * Heuristic and model-judged territory, so it warns and the reviewer decides.
 * A `trace` focus is left alone: the trace carries tool inputs too.
 */
export const rule: Rule = {
  id: "EVAL011",
  severity: "warn",
  title: "llm criteria about tool inputs use focus: mock_calls",
  source:
    "from #411, not the docs: a judge reading only the last message cannot see what a tool was called with",
  checkCase: (c) =>
    c.graders.flatMap((g) => {
      if (g.type !== "llm") return [];
      const focus = g.focus.value;
      if (focus.kind === "mock_calls" || focus.kind === "trace") return [];
      if (!TOOL_INPUT_PHRASES.some((p) => p.test(g.criteria.value))) return [];
      const now = g.focus.explicit
        ? `focus: ${focus.kind === "unknown" ? focus.raw : focus.kind}`
        : "the default focus: last_message";
      return [
        {
          message: `${graderLabel(g)} appears to assert what a tool was called with (heuristic), but uses ${now} (from #411).`,
          fix: "Set `focus: mock_calls` so the judge sees the recorded tool calls, or replace it with a regex or tool_used (input_match) grader on mock_calls. Ignore this warning if the criteria are not about tool inputs.",
          loc: g.focus.explicit ? g.focus.loc : g.criteria.loc,
        },
      ];
    }),
};
