import { assess } from "../../discrimination.ts";
import { loadBadReply } from "../../check-replies.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL031: the case's own `# bad-reply:` passes every grader it has, all of them
 * runnable offline, so the case cannot fail the reply it was written to catch.
 * The shape-only cannot-fail (EVAL025) is not repeated here.
 */
export const rule: Rule = {
  id: "EVAL031",
  severity: "warn",
  title: "The # bad-reply header passes every grader in the case (tag smoke or probe to accept)",
  source: "from docs/adr/0002: check-replies.ts probeCase moved into discrimination.ts; a case that cannot fail its own bad reply cannot tell the plugin from no plugin",
  checkCase: (c) => {
    const bad = loadBadReply(c);
    if (bad === undefined || assess(c).state === "cannot-fail") return [];
    const a = assess(c, bad);
    if (a.state !== "cannot-fail" || a.exempt !== undefined) return [];
    return [
      {
        message: `Case '${c.name.value}': the # bad-reply header passes every grader in the case, so no run can fail it on that reply.`,
        fix: "Tighten a `regex` grader so the bad reply fails it, or rewrite the bad reply to be a mistake the graders should catch. Tag the case `smoke` or `probe` if holding is the point. Only the paid no-plugin baseline shows what the model really does.",
        loc: c.graders[0]?.origin.loc ?? c.name.loc,
      },
    ];
  },
};
