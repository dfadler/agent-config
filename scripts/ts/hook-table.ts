// The plugin hook table: scripts/plugin-hooks.tsv, the one data file shared by
// the bootstrap bash (scripts/plugin-hooks.sh) and TypeScript. See the file's
// header for the column meanings and why it is TSV.
import { err, ok, type Result } from "./lib/result.ts";

export interface HookRow {
  readonly event: string;
  /** "" when the event has no matcher concept. */
  readonly matcher: string;
  readonly feature: string;
  /** Hook script, relative to ~/.claude/skills/. */
  readonly script: string;
  /** Retired .sh path for the same row, relative to ~/.claude/skills/. */
  readonly legacy: string;
}

export const HOOK_TABLE_FILE = "scripts/plugin-hooks.tsv";

/** Parse the table text; `err` names the first malformed line. */
export const parseHookTable = (
  text: string,
): Result<string, readonly HookRow[]> => {
  const rows: HookRow[] = [];
  for (const [i, line] of text.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const cols = line.split("\t");
    const [event, matcher, feature, script, legacy] = cols;
    if (
      cols.length !== 5 ||
      event === undefined ||
      matcher === undefined ||
      feature === undefined ||
      script === undefined ||
      legacy === undefined ||
      cols.some((c) => c === "")
    ) {
      return err(`line ${String(i + 1)}: expected 5 non-empty tab-separated columns`);
    }
    rows.push({ event, matcher: matcher === "-" ? "" : matcher, feature, script, legacy });
  }
  return ok(rows);
};

/** The shell-form command line setup registers for a row. */
export const shellCommand = (row: HookRow, home: string): string =>
  `node "${home}/.claude/skills/${row.script}"`;

/** The retired command setup/teardown sweep for a row. */
export const legacyCommand = (row: HookRow, home: string): string =>
  `${home}/.claude/skills/${row.legacy}`;
