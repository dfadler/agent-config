import { isBoundaryCase, scoreCase } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { scoringContextFor } from "../scoring-context.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/** EVAL008: when every grader is excluded in a two-arm run, all score normally, but none can pass without the plugin, so the delta is vacuous. */
export const rule: Rule = {
  id: "EVAL008",
  severity: "warn",
  title:
    "Every grader is excluded from scoring, so the delta is vacuous",
  source: fromDocs("baseline scoring"),
  checkCase: (c, context) => {
    // A trigger-boundary case runs plugin-arm only, where nothing is excluded from scoring.
    if (isBoundaryCase(c)) return [];
    const scoring = scoreCase(c, true, scoringContextFor(c, context));
    if (!scoring.allExcludedFallback) return [];
    const names = c.graders.map(graderLabel).join(", ");
    return [
      {
        message: `Every grader in case '${c.name.value}' (${names}) is excluded from scoring in a two-arm run, so they are scored normally, but none can pass in the no-plugin arm (a Skill or plugin-mock check), so the delta is vacuous: the plugin's presence inflates it.`,
        fix: "Add a grader that is scored in both arms (a regex, file_exists or llm grader, or set `arm: both` on one), or run this case with --ablation none.",
        loc: c.name.loc,
      },
    ];
  },
};
