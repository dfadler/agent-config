import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/** A quantified group that itself holds a quantifier, e.g. `(a*)*`: the shape that backtracks catastrophically. */
const NESTED_QUANTIFIER = /\([^)]*[*+}][^)]*\)[*+{]/;
const MAX_PROMPT_CHARS = 20_000;

/** EVAL024: a last_message regex that already matches the prompt passes (or fails) on an echo, not on the skill's effect. */
export const rule: Rule = {
  id: "EVAL024",
  severity: "warn",
  title: "regex grader on last_message matches text already in the case prompt",
  source: 'from #713: "did not mention Y" passed when the prompt itself contained Y',
  checkCase: (c) => {
    const prompt = c.prompt.value;
    if (prompt === undefined || prompt.length > MAX_PROMPT_CHARS) return [];
    return c.graders.flatMap((g) => {
      if (g.type !== "regex" || g.target.value.kind !== "last_message") return [];
      // ponytail: heuristic ReDoS guard, not a proof; skipping loses only this check.
      if (NESTED_QUANTIFIER.test(g.pattern.value)) return [];
      let re: RegExp;
      try {
        re = new RegExp(g.pattern.value, g.flags.value);
      } catch {
        return []; // an invalid pattern is EVAL012's and the parser's to report
      }
      if (!re.test(prompt)) return [];
      return [
        {
          message: `${graderLabel(g)} pattern '${g.pattern.value}' matches the case prompt itself, so a reply that echoes the prompt satisfies (or trips) it whether or not the skill did anything.`,
          fix: "Match wording only the skill or a correct answer would add, or grade behavior with `tool_used` or a `regex` on the trace.",
          loc: g.pattern.loc,
        },
      ];
    });
  },
};
