import { isScored } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import { checksMockCalls, scoringContextFor } from "../scoring-context.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/** EVAL010: a mock_calls grader on a plugin-declared mock is unscored in a two-arm run unless `arm: both`. */
export const rule: Rule = {
  id: "EVAL010",
  severity: "info",
  title:
    "mock_calls grader on a plugin-declared mock without arm: both is an indicator only",
  source: fromDocs("baseline scoring"),
  checkCase: (c, context) => {
    const ctx = scoringContextFor(c, context);
    return c.graders.flatMap((g): readonly Problem[] =>
      checksMockCalls(g) && !isScored(g, true, ctx)
        ? [
            {
              message: `${graderLabel(g)} checks mock calls on a plugin-declared mock without 'arm: both', so it is left out of the score in a two-arm run.`,
              fix: "Set `arm: both` if the check should count toward the score, or keep it as an indicator.",
              loc: g.origin.loc,
            },
          ]
        : [],
    );
  },
};
