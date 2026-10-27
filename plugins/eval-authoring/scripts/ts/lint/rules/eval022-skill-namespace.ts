import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/**
 * True when `pattern` matches a bare `"skill":"name"` call, for a word taken
 * from the pattern, but not the same call with a `plugin:` prefix. Testing
 * sample inputs instead of the pattern's text catches `"skill": "name`,
 * `"skill":"(a|b)"` and `\s?`, and leaves a pattern that already allows a prefix alone.
 */
const missesPrefixedCall = (pattern: string): boolean => {
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return false; // an invalid regex is EVAL012's business
  }
  // A prefix written into the pattern (`(?:screen-capture:)?`) is the installed plugin's own.
  const prefixes = ["zz-plugin", ...(pattern.match(/[A-Za-z][\w-]*(?=:)/g) ?? [])];
  return (pattern.match(/[A-Za-z][\w-]*/g) ?? []).some((w) =>
    ['"skill":"', '"skill": "'].some(
      (k) => re.test(`${k}${w}"`) && !prefixes.some((p) => re.test(`${k}${p}:${w}"`)),
    ),
  );
};

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
      if (m === undefined || !missesPrefixedCall(m)) return [];
      return [
        {
          message: `${graderLabel(g)} input_match '${m}' matches a bare skill name but not a 'plugin:name' call, so an installed plugin's call never matches and firing is undercounted (from #713).`,
          fix: 'Allow the prefix: `"skill"\\s*:\\s*"(?:[\\w-]+:)?name"`.',
          loc: g.inputMatch.loc,
        },
      ];
    }),
};
