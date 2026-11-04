import { isMustFire, isMustNotFire } from "../../parser/index.ts";
import type { Grader } from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

/** A plain boolean, not a type guard: negating two guards on a `ToolUsedGrader` would narrow it to `never`. */
const hasRole = (g: Grader): boolean => isMustFire(g) || isMustNotFire(g);

/**
 * EVAL029: a `tool_used: Skill` check has a role only through its bounds: `min >= 1`
 * (fires) or `max: 0` (must-not-fire). The run summary and the trigger table read
 * the role from those two numbers, never the grader's name, so a Skill check with
 * neither (`min: 0` with no `max`, or `min: 0` with `max: 2`) is counted in neither
 * rate and cannot fail on whether the skill fired.
 */
export const rule: Rule = {
  id: "EVAL029",
  severity: "warn",
  title: "A tool_used Skill check has no role: neither min >= 1 (fires) nor max: 0 (must-not-fire)",
  source: "from the grader-roles design (#858): fire and false-fire rates are read from min and max, not from grader names",
  checkCase: (c) =>
    c.graders.flatMap((g) =>
      g.type === "tool_used" && g.tool.value === "Skill" && !hasRole(g)
        ? [
            {
              message: `${graderLabel(g)} checks the Skill tool with min ${String(g.min.value)} and max ${g.max.value === undefined ? "unset" : String(g.max.value)}, which is neither a fire check nor a must-not-fire check, so the run summary counts it in no rate.`,
              fix: "Set `min: 1` if the skill must fire, or `max: 0` (with `min: 0`) if it must stay quiet; if it only bounds how often the skill runs, check that with a grader of another kind.",
              loc: g.origin.loc,
            },
          ]
        : [],
    ),
};
