/** Small helpers shared by rules, so messages name things the same way. */
import type { Grader } from "../parser/index.ts";

/** How a message refers to a grader: its name, or `#2` (1-based position) when it has none. */
export const graderLabel = (g: Grader): string =>
  `grader '${g.name.value ?? `#${String(g.origin.index + 1)}`}'`;

// The vacuity predicates moved to discrimination.ts (docs/adr/0002); re-exported for the rules that import them here.
export { echoesPrompt, isQuietSkillCheck } from "../discrimination.ts";
