import { echoesPrompt, graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/** EVAL024: a last_message regex that already matches the prompt passes (or fails) on an echo, not on the skill's effect. */
export const rule: Rule = {
  id: "EVAL024",
  severity: "warn",
  title: "regex grader on last_message matches text already in the case prompt",
  source: 'from #713: "did not mention Y" passed when the prompt itself contained Y',
  checkCase: (c) => {
    const prompt = c.prompt.value;
    if (prompt === undefined) return [];
    return c.graders.flatMap((g) => {
      if (!echoesPrompt(g, prompt)) return [];
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
