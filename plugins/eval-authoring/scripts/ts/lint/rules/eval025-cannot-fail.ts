import { assess } from "../../discrimination.ts";
import type { Rule } from "../types.ts";

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
    // No bad reply here: only the shape (quiet Skill checks and prompt-cued regexes) can say cannot-fail.
    const a = assess(c);
    // `smoke` labels a two-arm guard and `probe` a safety probe (EVAL030 asks it to say why it might fail); a trigger-boundary case is read as a fire count, not a score (EVAL028).
    if (a.state !== "cannot-fail" || a.exempt !== undefined) return [];
    return [
      {
        message: `Case '${c.name.value}': every grader is a "must not fire" Skill check (the no-plugin arm passes it by construction) or a regex whose text is in the prompt, so only the with-arm skill fire rate can fail, and it is noise at a few runs.`,
        fix: "Grade a trace action in a fixture workspace, or move it to the trigger-boundary suite (tag `trigger-boundary` and `pair:<should-fire case>`, drop `arm: both`), or tag the case `smoke` to label it a cheap two-arm guard with no expected delta, or `probe` if the right outcome is that the model does nothing dangerous (add an `expected_outcome` saying what failure looks like), or drop it.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
