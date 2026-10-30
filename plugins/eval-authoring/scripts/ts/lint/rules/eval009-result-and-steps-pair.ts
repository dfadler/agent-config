import { scoreCase, graderCategory } from "../../parser/index.ts";
import { scoringContextFor } from "../scoring-context.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL009: a stable signal wants one grader on the result and one on the steps
 * taken, at least one of them scored. `tool_used: Skill` is an indicator, not
 * a signal (it is unscored in a two-arm run), so it does not satisfy the pair
 * on its own.
 */
export const rule: Rule = {
  id: "EVAL009",
  severity: "info",
  optIn: true, // #811: fired on about half of all cases, and its own fix excuses reply-only skills // #811: fired on about half of all cases, and its own fix excuses reply-only skills
  title: "Case pairs a result grader with a steps grader",
  source: fromDocs("graders that give a stable signal"),
  checkCase: (c, context) => {
    if (c.graders.length === 0) return [];
    const scoring = scoreCase(c, true, scoringContextFor(c, context));
    const scored = scoring.graders.filter((g) => g.scored);
    const result = scored.filter(
      (g) => graderCategory(g.grader) === "result",
    );
    const steps = scored.filter((g) => graderCategory(g.grader) === "steps");
    if (result.length > 0 && steps.length > 0) return [];
    const missing = [
      ...(result.length === 0 ? ["scored grader on the result"] : []),
      ...(steps.length === 0 ? ["scored grader on the steps taken"] : []),
    ];
    return [
      {
        message: `Case '${c.name.value}' has no ${missing.join(" and no ")}, so it lacks the result plus steps pair that gives a stable signal.`,
        fix: "Add one grader on the outcome (regex on last_message or a file, file_exists) and one on the steps (tool_used other than Skill, tool_order, or a trace or mock_calls target). Use `arm: both` where a negative check must count in both arms. A reply-only skill has no step to check: keep its unscored Skill check and grade the reply, and leave this rule off.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
