import { assess } from "../../discrimination.ts";
import { loadBadReply } from "../../check-replies.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL032: a case with a runnable `last_message` regex and no `# bad-reply:` header
 * leaves the free check nothing to run, so "can this case fail?" stays unproven.
 * llm, tool_used and file_exists-only cases are not nagged: nothing offline runs them.
 */
export const rule: Rule = {
  id: "EVAL032",
  severity: "warn",
  // 217 hits over the 30 plugins with evals on 2026-11-16, and the acceptance tests demand a warning-free lint: opt in with `--enable EVAL032` until the cases carry headers.
  optIn: true,
  title: "Case with a last_message regex has no # bad-reply header (tag smoke or probe to accept)",
  source: "from docs/adr/0001 and CONTEXT.md 'Discrimination State': unproven is never reported as ok",
  checkCase: (c) => {
    const a = assess(c);
    if (a.state === "cannot-fail" || a.exempt !== undefined) return [];
    const regex = c.graders.find((g) => g.type === "regex" && g.target.value.kind === "last_message");
    if (regex === undefined || loadBadReply(c) !== undefined) return [];
    return [
      {
        message: `Case '${c.name.value}' has a last_message regex grader but no # bad-reply header, so the lint cannot check that any grader fails a wrong reply.`,
        fix: "Add `# bad-reply: <a plausible wrong reply>` (and `# good-reply:`) comment lines before the first key of case.yaml (just inside the `---` of prompt.md), or tag the case `smoke` or `probe`. See scripts/ts/check-replies.ts.",
        loc: regex.origin.loc,
      },
    ];
  },
};
