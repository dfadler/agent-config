/**
 * The trigger-boundary suite convention, shared by the lint (EVAL028) and the
 * run-evals `--trigger-boundary` mode. A should-not-fire case declares itself
 * with the tag `trigger-boundary` and names its should-fire twin with one tag
 * `pair:<case-name>`. Tags, not a new key or a header comment: the CLI ignores
 * or rejects unknown keys, and a tag needs no file read.
 */
import type { EvalCase, Grader, ToolUsedGrader } from "./types.ts";

export const TRIGGER_BOUNDARY_TAG = "trigger-boundary";
const PAIR_PREFIX = "pair:";

/** The case names its `pair:<name>` tags give, in tag order. */
export const pairTags = (c: EvalCase): readonly string[] =>
  c.tags.value.filter((t) => t.startsWith(PAIR_PREFIX)).map((t) => t.slice(PAIR_PREFIX.length));

export const isBoundaryCase = (c: EvalCase): boolean => c.tags.value.includes(TRIGGER_BOUNDARY_TAG);

const isRouteCheck = (g: Grader): g is ToolUsedGrader =>
  g.type === "tool_used" && (g.tool.value === "Skill" || g.tool.value === "Agent");

/** "Must not fire": a `tool_used` on Skill or Agent with `max: 0`. */
export const isMustNotFire = (g: Grader): g is ToolUsedGrader => isRouteCheck(g) && g.max.value === 0;

/** "Must fire": a `tool_used` on Skill or Agent with `min >= 1`. */
export const isMustFire = (g: Grader): g is ToolUsedGrader =>
  isRouteCheck(g) && g.min.value >= 1 && g.max.value !== 0;

/** Same tool and a present, equal `input_match`: two checks about the same skill or agent. An absent matcher matches nothing, so two unscoped checks never pair. */
export const sameTarget = (a: ToolUsedGrader, b: ToolUsedGrader): boolean =>
  a.tool.value === b.tool.value && a.inputMatch.value !== undefined && a.inputMatch.value === b.inputMatch.value;

/** The twin's named must-fire checks about a target the negative must not fire (run-evals reads results by grader name). */
export const twinFireGraders = (negative: EvalCase, twin: EvalCase): readonly ToolUsedGrader[] => {
  const quiet = negative.graders.filter(isMustNotFire);
  return twin.graders.filter(isMustFire).filter((g) => g.name.value !== undefined && quiet.some((q) => sameTarget(q, g)));
};
