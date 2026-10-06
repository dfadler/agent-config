import { grantsForCase } from "../../parser/index.ts";
import { fromDocs } from "../sources.ts";
import type { Rule } from "../types.ts";

/**
 * EVAL021: a grant for a tool the case never lists in `allowed_tools`. Matches by tool
 * name only (like EVAL004), so `Bash(npx *)` is satisfied by any `Bash(...)` entry.
 * Grants for cases that do not exist are already reported as PARSE, so are not seen here.
 */
export const rule: Rule = {
  id: "EVAL021",
  severity: "warn",
  title:
    "grants.yaml grants a tool the case never lists in allowed_tools (the grant widens permissions for nothing)",
  source: fromDocs(
    "Grant tools; a grant applies to every case in its run, so an unneeded grant widens permissions",
  ),
  checkCase: (c, { grants }) => {
    const listed = new Set(c.allowedTools.value.map((t) => t.tool));
    return grantsForCase(grants, c.name.value)
      .filter((g) => !listed.has(g.tool))
      .map((g) => ({
        message: `grants.yaml grants '${g.raw}' to case '${c.name.value}', but the case does not list ${g.tool} in allowed_tools, so the grant only widens the permissions of its run.`,
        fix: `Remove "${g.raw}" from grants.${c.name.value} in evals/grants.yaml, or add ${g.tool} to the case's allowed_tools if it needs it.`,
        loc: g.loc,
      }));
  },
};
