/** Small helpers shared by rules, so messages name things the same way. */
import type { Grader } from "../parser/index.ts";

/** How a message refers to a grader: its name, or `#2` (1-based position) when it has none. */
export const graderLabel = (g: Grader): string =>
  `grader '${g.name.value ?? `#${String(g.origin.index + 1)}`}'`;
