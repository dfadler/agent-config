import { scoreCase } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { scoringContextFor } from "../scoring-context.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/** EVAL008: when every grader is excluded in a two-arm run, all score normally and there is no delta. */
export const rule: Rule = {
  id: "EVAL008",
  severity: "warn",
  title:
    "Every grader is excluded from scoring, so the case gives no delta signal",
  source: fromDocs("baseline scoring"),
  checkCase: (c, context) => {
    const scoring = scoreCase(c, true, scoringContextFor(c, context));
    if (!scoring.allExcludedFallback) return [];
    const names = c.graders.map(graderLabel).join(", ");
    return [
      {
        message: `Every grader in case '${c.name.value}' (${names}) is excluded from scoring in a two-arm run, so the plugin and no-plugin arms cannot be told apart.`,
        fix: "Add a grader that is scored in both arms (a regex, file_exists or llm grader, or set `arm: both` on one), or run this case with --ablation none.",
        loc: c.name.loc,
      },
    ];
  },
};
