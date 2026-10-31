import { readFileSync } from "node:fs";
import { headerReplies } from "../../check-replies.ts";
import { graderLabel } from "../helpers.ts";
import type { Rule } from "../types.ts";

const blank = (s: string | undefined): boolean => s === undefined || s.trim() === "";

/**
 * EVAL026: a case with an `llm` grader should carry a reference-good and a
 * known-bad reply in its header, the pair `check-replies.ts` reads. A judge
 * cannot be run offline, so the pair is the only label set a reviewer has to
 * check the criteria against. Info for now: `check-replies.ts` reports the same
 * gap as "missing", an error only under `--require`, which nothing runs.
 */
export const rule: Rule = {
  id: "EVAL026",
  severity: "info",
  title: "Case with an llm grader has no # good-reply and # bad-reply header",
  source:
    "from #763 (check-replies.ts header convention) and the Eval Research doc: a judge is only as good as the labeled replies it was checked against",
  checkCase: (c) => {
    const judge = c.graders.find((g) => g.type === "llm");
    const file = c.caseYamlFile ?? c.promptFile;
    if (judge === undefined || file === undefined) return [];
    const { good, bad } = headerReplies(readFileSync(file, "utf8"));
    const missing = [
      ...(blank(good) ? ["# good-reply:"] : []),
      ...(blank(bad) ? ["# bad-reply:"] : []),
    ];
    if (missing.length === 0) return [];
    return [
      {
        message: `Case '${c.name.value}' has an llm grader (${graderLabel(judge)}) but its header lacks ${missing.join(" and ")}, so nothing can check the judge's criteria against a reply you labeled.`,
        fix: "Add `# good-reply: <a reply the judge should pass>` and `# bad-reply: <a reply it should fail>` comment lines before the first key of case.yaml (just inside the `---` of prompt.md); continuation lines are comments indented by two spaces. See scripts/ts/check-replies.ts.",
        loc: judge.origin.loc,
      },
    ];
  },
};
