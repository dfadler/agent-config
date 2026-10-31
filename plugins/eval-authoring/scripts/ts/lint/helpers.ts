/** Small helpers shared by rules, so messages name things the same way. */
import type { Grader, RegexGrader, ToolUsedGrader } from "../parser/index.ts";

/** How a message refers to a grader: its name, or `#2` (1-based position) when it has none. */
export const graderLabel = (g: Grader): string =>
  `grader '${g.name.value ?? `#${String(g.origin.index + 1)}`}'`;

/** "Must not invoke the skill": `tool_used: Skill`, `max: 0`, scored in both arms (the no-plugin arm passes it by construction). Used by EVAL020, EVAL025. */
export const isQuietSkillCheck = (g: Grader): g is ToolUsedGrader =>
  g.type === "tool_used" && g.tool.value === "Skill" && g.max.value === 0 && g.arm.value === "both";

/** A quantified group that itself holds a quantifier, e.g. `(a*)*`: the shape that backtracks catastrophically. */
const NESTED_QUANTIFIER = /\([^)]*[*+}][^)]*\)[*+{]/;
const MAX_PROMPT_CHARS = 20_000;

/** A `last_message` regex whose pattern already matches `prompt`, so an echo of the prompt satisfies (or trips) it. Used by EVAL024, EVAL025. */
export const echoesPrompt = (g: Grader, prompt: string): g is RegexGrader => {
  if (g.type !== "regex" || g.target.value.kind !== "last_message" || prompt.length > MAX_PROMPT_CHARS) return false;
  // ponytail: heuristic ReDoS guard, not a proof; skipping loses only this check.
  if (NESTED_QUANTIFIER.test(g.pattern.value)) return false;
  try {
    return new RegExp(g.pattern.value, g.flags.value).test(prompt);
  } catch {
    return false; // an invalid pattern is EVAL012's and the parser's to report
  }
};
