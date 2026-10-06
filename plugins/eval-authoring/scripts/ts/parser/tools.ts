import type { AllowedTool, SourceLoc } from "./types.ts";

/**
 * Parse an `allowed_tools` or grants entry: `Bash` out of `Bash(npx *)`.
 * A bare name has no specifier; `Bash()` has the empty specifier.
 * Used by EVAL004, EVAL005.
 */
export const parseAllowedTool = (raw: string, loc: SourceLoc): AllowedTool => {
  const open = raw.indexOf("(");
  if (open > 0 && raw.endsWith(")")) {
    return {
      raw,
      tool: raw.slice(0, open).trim(),
      specifier: raw.slice(open + 1, -1),
      loc,
    };
  }
  return { raw, tool: raw.trim(), specifier: undefined, loc };
};
