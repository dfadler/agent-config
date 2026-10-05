import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/** The tag the run wrapper's quick tier selects with `--tag quick`. */
const QUICK_TAG = "quick";

/** EVAL017: a case tagged `quick` must cost no judge calls. */
export const rule: Rule = {
  id: "EVAL017",
  severity: "error",
  title: "Case tagged quick has an llm or baseline grader",
  source:
    "from #473: the quick tag marks free-only cases so `--tag quick` runs at no judge cost, and the lint keeps the tag accurate",
  checkCase: (c) => {
    if (!c.tags.value.includes(QUICK_TAG)) return [];
    return c.graders.flatMap((g) =>
      g.type === "llm" || g.type === "baseline"
        ? [
            {
              message: `Case '${c.name.value}' is tagged '${QUICK_TAG}' but ${graderLabel(g)} is ${g.type}, a paid grader (from #473).`,
              fix: `Replace it with free graders (regex, tool_used, tool_order, file_exists), or remove the '${QUICK_TAG}' tag from tags so the quick tier does not run it.`,
              loc: g.origin.loc,
            },
          ]
        : [],
    );
  },
};
