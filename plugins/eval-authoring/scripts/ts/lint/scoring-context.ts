/** Scoring helpers shared by the scoring rules (EVAL008, EVAL010). */
import {
  readMocks,
  type EvalCase,
  type Grader,
  type ScoringContext,
} from "../parser/index.ts";
import type { LintContext } from "./types.ts";

/**
 * The scoring context for a case: the servers the case can mock that the
 * plugin also declares in its MCP config. A mock for a server the plugin does
 * not declare (EVAL013's concern) is not a plugin-declared mock.
 */
export const scoringContextFor = (
  evalCase: EvalCase,
  context: LintContext,
): ScoringContext => {
  const catalog = readMocks(
    context.pluginRoot,
    context.suite.evalDir,
    evalCase.dir,
  );
  const mcp = new Set(catalog.mcpServers);
  return {
    declaredMockServers: new Set(
      [...catalog.declaredServers].filter((server) => mcp.has(server)),
    ),
  };
};

/** True when a `regex` or `llm` grader looks at the mock calls. */
export const checksMockCalls = (grader: Grader): boolean =>
  (grader.type === "regex" && grader.target.value.kind === "mock_calls") ||
  (grader.type === "llm" && grader.focus.value.kind === "mock_calls");
