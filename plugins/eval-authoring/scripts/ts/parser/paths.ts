/**
 * Stub for the path helper (#487, Agent B). Replace the body; keep the
 * signature. Used by EVAL014 (`scaffold_script`, `fixtures/bin`) and EVAL018
 * (`plugins:` entries).
 */
import { notImplemented } from "./not-implemented.ts";
import type { ResolvedPath } from "./types.ts";

/** Resolve `relativePath` against `caseDir` and check it stays inside `pluginRoot`. Does not follow symlinks. */
export const resolveCasePath: (
  caseDir: string,
  relativePath: string,
  pluginRoot: string,
) => ResolvedPath = () => notImplemented("resolveCasePath");
