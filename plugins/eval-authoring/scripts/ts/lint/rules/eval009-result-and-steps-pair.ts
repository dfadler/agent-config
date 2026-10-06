import { scoreCase, graderCategory } from "../../parser/index.ts";
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
  title: "Case pairs a result grader with a steps grader",
  source: fromDocs("graders that give a stable signal"),
  checkCase: (c, { suite }) => {
    if (c.graders.length === 0) return [];
    const scoring = scoreCase(c, true, {
      declaredMockServers: suite.mocks.declaredServers,
    });
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
        fix: "Add one grader on the outcome (regex on last_message or a file, file_exists) and one on the steps (tool_used other than Skill, tool_order, or a trace or mock_calls target). Use `arm: both` where a negative check must count in both arms.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
