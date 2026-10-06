import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

const PASS = /\bpass(?:es|ed)?\b/i;
const FAIL = /\bfail(?:s|ed)?\b/i;

/**
 * EVAL006: an `llm` grader's criteria should state PASS and FAIL conditions.
 * Mechanical only: whether the conditions are concrete is the case-reviewer's.
 */
export const rule: Rule = {
  id: "EVAL006",
  severity: "warn",
  title: "llm criteria state explicit PASS and FAIL conditions",
  source: `${fromDocs("advises PASS and FAIL wording in llm criteria")}. The evidence that a vague criterion such as "must mention X" scored 0.00 on correct output is from #411, not the docs`,
  checkCase: (c) =>
    c.graders.flatMap((g) => {
      if (g.type !== "llm") return [];
      const text = g.criteria.value;
      const missing = [
        ...(PASS.test(text) ? [] : ["PASS"]),
        ...(FAIL.test(text) ? [] : ["FAIL"]),
      ];
      if (missing.length === 0) return [];
      return [
        {
          message: `${graderLabel(g)} has llm criteria with no explicit ${missing.join(" or ")} condition (docs advice; #411 saw vague criteria score 0.00 on correct output).`,
          fix: 'Write the criteria as "PASS if <observable condition>. FAIL if <observable condition>." The lint only checks the words are present; the case-reviewer judges whether they are concrete.',
          loc: g.criteria.explicit ? g.criteria.loc : g.origin.loc,
        },
      ];
    }),
};
