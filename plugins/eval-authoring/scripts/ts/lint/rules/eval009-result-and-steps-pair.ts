import { scoreCase, graderCategory } from "../../parser/index.ts";
import { scoringContextFor } from "../scoring-context.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL009: a case needs at least one scored grader on the result (the reply or
 * a file). Grade the final state, not the path: without an outcome grader the
 * case cannot show the plugin changed the result. `tool_used: Skill` is an
 * indicator, unscored in a two-arm run, so it never counts as one.
 */
export const rule: Rule = {
  id: "EVAL009",
  severity: "info",
  optIn: true, // #811: off by default because it fired on half of all cases before it was narrowed to the result half.
  title: "Case has no scored grader on the result",
  source:
    'from the Eval Research doc: "grade the final state, not the path", and decision 7 (every should-fire case needs a real outcome grader)',
  checkCase: (c, context) => {
    if (c.graders.length === 0) return [];
    const scoring = scoreCase(c, true, scoringContextFor(c, context));
    const hasResult = scoring.graders.some(
      (g) => g.scored && graderCategory(g.grader) === "result",
    );
    if (hasResult) return [];
    return [
      {
        message: `Case '${c.name.value}' has no scored grader on the result, so it cannot show the plugin changed the outcome (from the Eval Research doc: grade the final state, not the path).`,
        fix: "Add a grader on the outcome (a regex on last_message or a file, file_exists, or an llm judge) that counts in both arms: not `arm: with-only`, and not a Skill, trace or mock_calls check.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
