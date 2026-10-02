// Pure core of check-shell-set-flags.ts: from (path, contents, executable bit)
// to violations. No file access here; the entrypoint owns discovery and I/O.

/** Why a script was flagged. */
export type ViolationKind = "non-executable" | "missing-set-flags";

export interface Violation {
  readonly file: string;
  readonly kind: ViolationKind;
}

const isBlankOrComment = (line: string): boolean =>
  /^\s*$/.test(line) || /^\s*#/.test(line);

/**
 * The header: every line before the first real statement (blank lines and
 * comments, the shebang included). Where the sourced-only marker must sit.
 */
export const headerLines = (lines: readonly string[]): readonly string[] => {
  const end = lines.findIndex((l) => !isBlankOrComment(l));
  return end === -1 ? lines : lines.slice(0, end);
};

/** A literal `# sourced-only` comment line in the header, nowhere else. */
export const isSourcedOnly = (lines: readonly string[]): boolean =>
  headerLines(lines).includes("# sourced-only");

/**
 * The first line that is not the shebang (when line 1 is one), blank, or a
 * comment; `undefined` when the file has none.
 */
export const firstStatement = (
  lines: readonly string[],
  hasShebang: boolean,
): string | undefined =>
  lines.slice(hasShebang ? 1 : 0).find((l) => !isBlankOrComment(l));

/**
 * `set -<flags> pipefail` where the flag cluster has both u and o. Only -o
 * consumes the next word, so `set -eu pipefail` leaves pipefail an unused
 * positional parameter and never enables it.
 */
export const declaresStrictSet = (statement: string | undefined): boolean => {
  const match = /^set (-[a-zA-Z]+) pipefail$/.exec(statement ?? "");
  const flags = match?.[1] ?? "";
  return flags.includes("u") && flags.includes("o");
};

/**
 * Violations for one script. A file carrying the sourced-only marker is
 * exempt from both checks; a missing shebang alone is not evidence. The
 * executable bit is only required of shebang'd files.
 */
export const checkScript = (
  file: string,
  contents: string,
  executable: boolean,
): readonly Violation[] => {
  const lines = contents.split("\n");
  if (isSourcedOnly(lines)) return [];
  const hasShebang = (lines[0] ?? "").startsWith("#!");
  const nonExecutable: readonly Violation[] =
    hasShebang && !executable ? [{ file, kind: "non-executable" }] : [];
  const missing: readonly Violation[] = declaresStrictSet(
    firstStatement(lines, hasShebang),
  )
    ? []
    : [{ file, kind: "missing-set-flags" }];
  return [...nonExecutable, ...missing];
};

const section = (
  violations: readonly Violation[],
  kind: ViolationKind,
  heading: string,
): readonly string[] => {
  const files = violations.filter((v) => v.kind === kind);
  return files.length === 0
    ? []
    : [heading, ...files.map((v) => `  ${v.file}`)];
};

/** The stderr report for a set of violations, or `undefined` when clean. */
export const formatViolations = (
  violations: readonly Violation[],
): string | undefined =>
  violations.length === 0
    ? undefined
    : [
        ...section(
          violations,
          "non-executable",
          "::error::Has a shebang but is not marked executable (chmod +x) in:",
        ),
        ...section(
          violations,
          "missing-set-flags",
          "::error::Missing 'set -uo pipefail' (or -euo) as the first statement in:",
        ),
        "See the shell-script hygiene baseline in ~/.claude/CLAUDE.md.",
      ].join("\n");
