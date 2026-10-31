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
