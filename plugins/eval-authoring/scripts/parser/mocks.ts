/**
 * Stub for the mock reader (#487, Agent B). Replace the body; keep the
 * signature. Used by EVAL013 and by `ScoringContext.declaredMockServers`.
 */
import { notImplemented } from "./not-implemented.ts";
import type { MockCatalog } from "./types.ts";

/**
 * Discover `<evalDir>/mocks/<server>/<tool>.md` and, when `caseDir` is given,
 * the case's own `mocks/`, which overrides the suite's file by file. Reads the
 * `type` and `expect` frontmatter, `.replay` presence, and the plugin's MCP
 * config server list.
 */
export const readMocks: (
  pluginRoot: string,
  evalDir: string,
  caseDir?: string,
) => MockCatalog = () => notImplemented("readMocks");
