import { graderLabel } from "../helpers.ts";
import type { Problem, Rule } from "../types.ts";

/** An `llm` judge sees only the first and last 12 messages of a `trace`. */
const JUDGE_TRACE_WINDOW = 12;

/**
 * EVAL023: two judge weaknesses. A bare `llm` grader on `last_message` can be
 * manipulated by the graded reply, and an `llm` grader on `trace` is blind to
 * the middle of a long run.
 */
export const rule: Rule = {
  id: "EVAL023",
  severity: "warn",
  title:
    "llm grader on last_message with no regex backstop, or on trace with max_turns above 12",
  source:
    "from #743: a reply can manipulate its judge (Eval Research, Judges), and an llm judge reads only the first and last 12 trace messages (plugin-evals docs)",
  checkCase: (c) => {
    const hasReplyRegex = c.graders.some(
      (g) => g.type === "regex" && g.target.value.kind === "last_message",
    );
    return c.graders.flatMap((g): readonly Problem[] => {
      if (g.type !== "llm") return [];
      const kind = g.focus.value.kind;
      if (kind === "last_message" && !hasReplyRegex) {
        return [
          {
            message: `${graderLabel(g)} is an llm judge on last_message and the case has no regex on last_message, so the reply being graded can talk the judge into a pass (from #743).`,
            fix: "Add a regex on last_message that pins the claim, plus a negative regex (match: not_contains) for rubric-echo phrases such as 'score: 10'. Put the rubric in the judge criteria, not the reply, and add one adversarial case whose reply claims a perfect score and must score 0.",
            loc: g.focus.loc,
            // Info: existing suites (fetch-execute-guide) judge the reply with no regex; advice, not a failure.
            severity: "info",
          },
        ];
      }
      if (kind === "trace" && c.maxTurns.value > JUDGE_TRACE_WINDOW) {
        return [
          {
            message: `${graderLabel(g)} is an llm judge on trace but max_turns is ${String(c.maxTurns.value)}; the judge sees only the first and last ${String(JUDGE_TRACE_WINDOW)} messages, so the middle of the run is graded blind (from #743).`,
            fix: `Lower max_turns to ${String(JUDGE_TRACE_WINDOW)} or less, or check the middle of the run with a regex on trace, tool_used or tool_order.`,
            loc: g.focus.loc,
          },
        ];
      }
      return [];
    });
  },
};
