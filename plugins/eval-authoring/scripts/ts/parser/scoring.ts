import type {
  CaseScoring,
  EvalCase,
  ExclusionReason,
  Grader,
  GraderCategory,
  GraderScoring,
  GraderTarget,
  ScoringContext,
} from "./types.ts";

/** The target a `regex` or `llm` grader looks at; undefined for the other types. */
const targetOf = (grader: Grader): GraderTarget | undefined => {
  switch (grader.type) {
    case "regex":
      return grader.target.value;
    case "llm":
      return grader.focus.value;
    case "tool_used":
    case "tool_order":
    case "file_exists":
    case "baseline":
    case "unknown":
      return undefined;
  }
};

/** Why a grader is left out of the score in a two-arm run, or undefined when it counts. */
const exclusionReason = (
  grader: Grader,
  context: ScoringContext | undefined,
): ExclusionReason | undefined => {
  // `arm: both` forces a grader that would otherwise be excluded to count.
  if (grader.arm.value === "both") return undefined;
  if (grader.arm.value === "with-only") return "arm-with-only";
  if (grader.type === "tool_used" && grader.tool.value === "Skill") {
    return "skill-grader-implicit-with-only";
  }
  // The grader alone cannot name the mocked servers, so the caller passes only
  // the servers the case mocks that the plugin also declares.
  if (
    targetOf(grader)?.kind === "mock_calls" &&
    context !== undefined &&
    context.declaredMockServers.size > 0
  ) {
    return "mock-calls-on-declared-mock";
  }
  return undefined;
};

/**
 * Whether a grader counts toward the score in a run. In a two-arm run:
 * `tool_used: Skill` is implicitly `with-only`, `arm: with-only` is unscored,
 * and a `mock_calls` grader on a plugin-declared mock is unscored unless
 * `arm: both`. With `twoArm` false, everything is scored. The "all excluded,
 * so all score" fallback is in `scoreCase`, not here. Used by EVAL008,
 * EVAL009, EVAL010.
 */
export const isScored = (
  grader: Grader,
  twoArm: boolean,
  context?: ScoringContext,
): boolean => !twoArm || exclusionReason(grader, context) === undefined;

/** `isScored` for every grader of a case, with reasons and the all-excluded fallback. Used by EVAL008, EVAL010. */
export const scoreCase = (
  evalCase: EvalCase,
  twoArm: boolean,
  context?: ScoringContext,
): CaseScoring => {
  const raw: readonly GraderScoring[] = evalCase.graders.map((grader) => {
    const reason = twoArm ? exclusionReason(grader, context) : undefined;
    return { grader, scored: reason === undefined, reason };
  });
  const allExcludedFallback = raw.length > 0 && raw.every((g) => !g.scored);
  return {
    // The docs: when every grader would be excluded, they all score normally.
    graders: allExcludedFallback
      ? raw.map((g) => ({ grader: g.grader, scored: true, reason: undefined }))
      : raw,
    allExcludedFallback,
  };
};

/**
 * Result versus steps taken, from `type` plus `target` or `focus`: `tool_used`
 * and `tool_order` and trace or mock-call targets check steps; the rest check
 * the result. Undefined for an unknown grader type. Used by EVAL009.
 */
export const graderCategory = (grader: Grader): GraderCategory | undefined => {
  if (grader.type === "unknown") return undefined;
  if (grader.type === "tool_used" || grader.type === "tool_order") {
    return "steps";
  }
  const kind = targetOf(grader)?.kind;
  return kind === "trace" || kind === "mock_calls" ? "steps" : "result";
};
