import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/** `"skill": "name` where the name starts right after the quote: no room for a `plugin:` prefix. */
const BARE_SKILL_NAME = /"skill"(?:\\s\*)?:(?:\\s\*)?"[\w-]/;

/** EVAL022: a Skill `input_match` must allow an optional `plugin:` prefix, or namespaced calls are never counted. */
export const rule: Rule = {
  id: "EVAL022",
  severity: "warn",
  title: "Skill input_match must allow an optional plugin: namespace prefix",
  source: 'from #713: a pattern for "skill":"name" never matches "skill":"plugin:name"',
  checkCase: (c) =>
    c.graders.flatMap((g) => {
      if (g.type !== "tool_used" || g.tool.value !== "Skill") return [];
      const m = g.inputMatch.value;
      if (m === undefined || !BARE_SKILL_NAME.test(m)) return [];
      return [
        {
          message: `${graderLabel(g)} input_match '${m}' puts the skill name right after the opening quote, so an installed plugin's 'plugin:name' call never matches and firing is undercounted (from #713).`,
          fix: 'Allow the prefix: `"skill"\\s*:\\s*"(?:[\\w-]+:)?name"`.',
          loc: g.inputMatch.loc,
        },
      ];
    }),
};
