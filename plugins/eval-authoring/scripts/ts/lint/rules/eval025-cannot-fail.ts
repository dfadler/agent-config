import type { Grader } from "../../parser/index.ts";
import type { Rule } from "../types.ts";

/** "Must not invoke the skill" in both arms: the no-plugin arm passes it by construction. */
const isQuietCheck = (g: Grader): boolean =>
  g.type === "tool_used" && g.tool.value === "Skill" && g.max.value === 0 && g.arm.value === "both";

/** Literal text of a top-level alternation, or undefined if any alternative uses regex syntax. */
const literals = (pattern: string): readonly string[] | undefined => {
  const alts = pattern.split(/(?<!\\)\|/);
  const isLiteral = (a: string): boolean => a !== "" && !/[\\()[\]{}*+?^$.]/.test(a.replace(/\\[^\w\s]/g, ""));
  return alts.every(isLiteral) ? alts.map((a) => a.replace(/\\([^\w\s])/g, "$1")) : undefined;
};

/** A `contains` regex on the reply whose every alternative is literal text from the prompt. */
const isCued = (g: Grader, prompt: string): boolean => {
  if (g.type !== "regex" || g.target.value.kind !== "last_message" || g.match.value !== "contains") return false;
  const alts = literals(g.pattern.value);
  if (alts === undefined) return false;
  const ci = (g.flags.value ?? "").includes("i");
  const hay = ci ? prompt.toLowerCase() : prompt;
  return alts.every((a) => hay.includes(ci ? a.toLowerCase() : a));
};

/**
 * EVAL025: every grader passes without the plugin by construction (a quiet
 * Skill check) or is cued by the prompt text, so the only live signal is the
 * with-arm fire rate. Opt out with the `smoke` tag (a labelled cheap guard).
 */
export const rule: Rule = {
  id: "EVAL025",
  severity: "warn",
  title: "Every grader passes without the plugin or is cued by the prompt (tag smoke to accept)",
  source: "from PR 789: a should-not-fire case scored 1.00 with and without; see author-cases, 'Can this case fail?'",
  checkCase: (c) => {
    const prompt = c.prompt.value ?? "";
    const dead = c.graders.length > 0 && c.graders.every((g) => isQuietCheck(g) || isCued(g, prompt));
    if (!dead || c.tags.value.includes("smoke")) return [];
    return [
      {
        message: `Case '${c.name.value}': every grader is a "must not fire" Skill check (the no-plugin arm passes it by construction) or a regex whose text is in the prompt, so only the with-arm skill fire rate can fail, and it is noise at a few runs.`,
        fix: "Grade a trace action in a fixture workspace, or tag the case `smoke` to label it a cheap trigger-boundary guard with no expected delta, or drop it.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
