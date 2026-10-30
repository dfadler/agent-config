import type { Grader, ToolUsedGrader } from "../../parser/index.ts";
import { isQuietSkillCheck } from "../helpers.ts";
import type { Rule } from "../types.ts";

const isSkillCheck = (g: Grader): g is ToolUsedGrader =>
  g.type === "tool_used" && g.tool.value === "Skill";

/**
 * EVAL020: a suite that checks the skill fires should also check it stays
 * quiet on at least one prompt. Heuristic and suite-wide: it cannot tell
 * which skill a prompt targets or whether the negative prompt is a good
 * near-miss, so it is info and never an error. The case-reviewer judges
 * the quality of the boundary; this only catches its absence.
 */
export const rule: Rule = {
  id: "EVAL020",
  severity: "info",
  title:
    "A suite that checks the skill fires has no case where it must not fire",
  source:
    "from #472: a useful eval covers the trigger boundary, prompts that should fire the skill and prompts that should not",
  checkSuite: ({ suite }) => {
    const checks = suite.cases.flatMap((c) => c.graders).filter(isSkillCheck);
    const firstPositive = checks.find((g) => g.min.value >= 1);
    if (firstPositive === undefined || checks.some(isQuietSkillCheck)) return [];
    return [
      {
        message: `The suite checks that the skill fires and no case checks that it stays quiet. A suite with only positive prompts cannot show the skill over-triggers (from #472).`,
        fix: "Add a case with a near-miss prompt (similar wording, a task the skill should not handle) and a tool_used grader: tool: Skill, min: 0, max: 0, arm: both. Ignore this if the plugin's skills are never mis-triggered.",
        loc: firstPositive.origin.loc,
      },
    ];
  },
};
