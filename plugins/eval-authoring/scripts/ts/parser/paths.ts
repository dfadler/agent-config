/**
 * Path helper (#487). Used by EVAL014 (`scaffold_script`, `fixtures/bin`) and
 * EVAL018 (`plugins:` entries).
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ResolvedPath } from "./types.ts";

/**
 * Resolve `relativePath` against `caseDir` and check it stays inside `pluginRoot`.
 * The check is lexical: it does not follow symlinks, so a symlink inside the
 * plugin directory that points elsewhere still counts as inside. Whether the
 * CLI accepts such a link is unverified (#449), so a rule must not treat
 * `insidePluginRoot` as proof of that. An absolute `relativePath` is resolved
 * as given and checked the same way. `exists` follows symlinks (a dangling link
 * is false).
 */
export const resolveCasePath = (
  caseDir: string,
  relativePath: string,
  pluginRoot: string,
): ResolvedPath => {
  const resolved = resolve(caseDir, relativePath);
  const fromRoot = relative(resolve(pluginRoot), resolved);
  const insidePluginRoot =
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot);
  return { resolved, insidePluginRoot, exists: existsSync(resolved) };
};
