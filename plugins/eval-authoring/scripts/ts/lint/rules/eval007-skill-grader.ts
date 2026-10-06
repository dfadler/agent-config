import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/** EVAL007: `tool_used: Skill` needs the Skill tool, and a negative Skill check is unscored in a two-arm run. */
export const rule: Rule = {
  id: "EVAL007",
  severity: "error",
  title:
    "tool_used: Skill without Skill in allowed_tools (error); a max 0 Skill check without arm: both (warn)",
  source: fromDocs("baseline scoring"),
  checkCase: (c) => {
    const skillAllowed = c.allowedTools.value.some((t) => t.tool === "Skill");
    return c.graders.flatMap((g): readonly Problem[] => {
      if (g.type !== "tool_used" || g.tool.value !== "Skill") return [];
      const missing: readonly Problem[] = skillAllowed
        ? []
        : [
            {
              message: `${graderLabel(g)} checks the Skill tool, but 'Skill' is not in allowed_tools for case '${c.name.value}'.`,
              fix: "Add Skill to allowed_tools so the skill can be invoked.",
              loc: c.allowedTools.loc,
              severity: "error",
            },
          ];
      const max = g.max.value;
      const unscored: readonly Problem[] =
        max !== undefined && max < 1 && g.arm.value !== "both"
          ? [
              {
                message: `${graderLabel(g)} is a max 0 Skill check without 'arm: both'; a Skill grader is treated as with-only and left out of the score in a two-arm run.`,
                fix: "Set `arm: both` so the check is scored in both arms, or accept that it is an indicator only.",
                loc: g.arm.explicit ? g.arm.loc : g.origin.loc,
                severity: "warn",
              },
            ]
          : [];
      return [...missing, ...unscored];
    });
  },
};
