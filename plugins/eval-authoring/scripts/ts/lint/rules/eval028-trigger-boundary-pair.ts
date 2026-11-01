import {
  isBoundaryCase,
  isMustNotFire,
  pairTags,
  twinFireGraders,
  TRIGGER_BOUNDARY_TAG,
  type EvalCase,
} from "../../parser/index.ts";
import { graderLabel } from "../helpers.ts";
import type { Problem, Rule } from "../types.ts";

/**
 * EVAL028: a case tagged `trigger-boundary` runs single-arm under
 * `run-evals --trigger-boundary`, which reads its fire count by grader name and
 * refuses to bound the over-trigger rate unless a paired should-fire twin fired
 * in the same run. So the case needs a named must-not-fire check, no `arm: both`
 * (the two-arm guard idiom), and exactly one `pair:<case>` tag naming a case that
 * must fire the same skill or agent.
 */
export const rule: Rule = {
  id: "EVAL028",
  severity: "warn",
  title: "A trigger-boundary case lacks a named must-not-fire check, runs two-arm, or has no should-fire twin",
  source: "from the trigger-boundary suite design: score negatives as a fire rate with a vacuity control, not a delta",
  checkCase: (c, { suite }) => {
    if (!isBoundaryCase(c)) return [];
    const name = c.name.value;
    const quiet = c.graders.filter(isMustNotFire);
    const at = c.tags.loc;
    const noCheck: readonly Problem[] =
      quiet.length > 0
        ? []
        : [
            {
              message: `Case '${name}' is tagged ${TRIGGER_BOUNDARY_TAG} but has no must-not-fire check, so the suite cannot count a fire.`,
              fix: "Add a tool_used grader: tool: Skill (or Agent), min: 0, max: 0, with the skill's input_match; or drop the tag.",
              loc: at,
            },
          ];
    const perGrader = quiet.flatMap((g): readonly Problem[] => [
      ...(g.name.value === undefined
        ? [
            {
              message: `${graderLabel(g)} in boundary case '${name}' has no name; run-evals reads the fire count by grader name.`,
              fix: "Give the grader a `name:`.",
              loc: g.origin.loc,
            },
          ]
        : []),
      ...(g.arm.value === "both"
        ? [
            {
              message: `${graderLabel(g)} in boundary case '${name}' sets \`arm: both\`, but a ${TRIGGER_BOUNDARY_TAG} case runs plugin-arm only (a two-arm run skips it).`,
              fix: "Remove `arm: both`; or, to keep the case as a two-arm regression alarm, drop the trigger-boundary and pair: tags and tag it `smoke`.",
              loc: g.arm.explicit ? g.arm.loc : g.origin.loc,
            },
          ]
        : []),
    ]);
    return [...noCheck, ...perGrader, ...pairProblems(c, suite.cases)];
  },
};

/** The `pair:` tag problems of boundary case `c`: none, several, an unknown or self name, or a twin that does not fire the same target. */
const pairProblems = (c: EvalCase, cases: readonly EvalCase[]): readonly Problem[] => {
  const name = c.name.value;
  const at = c.tags.loc;
  const pairs = pairTags(c);
  const [twinName] = pairs;
  if (twinName === undefined || pairs.length > 1) {
    return [
      {
        message:
          pairs.length === 0
            ? `Boundary case '${name}' has no pair:<case> tag, so a clean result cannot be told from a harness that never sees an invocation.`
            : `Boundary case '${name}' has ${String(pairs.length)} pair: tags; the report reads one twin per negative.`,
        fix: "Tag it `pair:<name>` with the name of the should-fire case this prompt was derived from (several negatives may share one twin).",
        loc: at,
      },
    ];
  }
  const twin = cases.find((x) => x.name.value === twinName);
  if (twin === undefined || twin === c) {
    return [
      {
        message: `Boundary case '${name}' names pair '${twinName}', which ${twin === c ? "is the case itself" : "is not a case in this suite"}.`,
        fix: "Point `pair:` at the name (the `name:` field) of a should-fire case in the same eval directory.",
        loc: at,
      },
    ];
  }
  const fires = twinFireGraders(c, twin);
  const covered = c.graders
    .filter(isMustNotFire)
    .every((g) => fires.some((t) => t.tool.value === g.tool.value && t.inputMatch.value === g.inputMatch.value));
  return covered
    ? []
    : [
        {
          message: `Boundary case '${name}' pairs with '${twinName}', which has no named must-fire check (tool_used, min >= 1) with the same tool and a present, equal input_match as the must-not-fire check, so it cannot show the harness sees that skill fire.`,
          fix: `Pair it with a case that has a named tool_used grader with the same tool and input_match and min: 1, or add one to '${twinName}'. Both checks need an input_match naming the skill or agent.`,
          loc: at,
        },
      ];
};
