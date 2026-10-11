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

/** How a hook is identified in settings.json: `command`, plus `args` in exec form. */
export interface HookCommand {
  readonly command: string;
  /** Absent in shell form. */
  readonly args?: readonly string[];
}

/**
 * The exec form setup registers (no shell, so no quoting; see
 * https://code.claude.com/docs/en/hooks#exec-form-and-shell-form).
 */
export const execHook = (row: HookRow, home: string): HookCommand => ({
  command: "node",
  args: [`${home}/.claude/skills/${row.script}`],
});

/** The earlier shell-form registration, `node "<path>"`, that setup migrates. */
export const shellHook = (row: HookRow, home: string): HookCommand => ({
  command: `node "${home}/.claude/skills/${row.script}"`,
});

/** The retired .sh registration setup/teardown sweep. */
export const legacyHook = (row: HookRow, home: string): HookCommand => ({
  command: `${home}/.claude/skills/${row.legacy}`,
});

/** Every form teardown removes for a row. */
export const allHookForms = (row: HookRow, home: string): readonly HookCommand[] => [
  execHook(row, home),
  shellHook(row, home),
  legacyHook(row, home),
];
