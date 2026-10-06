// Pure core of check-vitest-flags.ts and check-vitest-v3-names.ts (#479): from
// document text and `vitest --help` output to findings. No file or process
// access here; the entrypoints own discovery and I/O.

/** Flags from other tools that docs mention alongside Vitest's; never in `vitest --help`. */
export const NON_VITEST_FLAGS: readonly string[] = ["--max-old-space-size"];

const FLAG = /(?<![\w-])--[A-Za-z][\w.-]*/g;

/** `--no-file-parallelism` -> `fileParallelism`, `--merge-reports` -> `mergeReports`. */
export const normalizeFlag = (flag: string): string =>
  flag
    .replace(/^--(no-)?/, "")
    .replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());

/** Every distinct `--flag` token in `text`, minus other tools' flags, in first-seen order. */
export const extractFlags = (text: string): readonly string[] => {
  const found = (text.match(FLAG) ?? []).map((f) => f.replace(/[.-]+$/, ""));
  return [...new Set(found)].filter((f) => !NON_VITEST_FLAGS.includes(f));
};

/** The normalized flag names a `vitest --help --expand-help` output offers. */
export const helpFlags = (helpText: string): ReadonlySet<string> =>
  new Set(extractFlags(helpText).map(normalizeFlag));

/** Documented flags (from any file) that the help output does not offer. */
export const missingFlags = (
  documented: readonly string[],
  helpText: string,
): readonly string[] => {
  const known = helpFlags(helpText);
  return documented.filter((f) => !known.has(normalizeFlag(f)));
};

/** Vitest 3 option and env names that Vitest 4+ removed or renamed. */
const V3_NAMES =
  /poolOptions|maxThreads|maxForks|singleThread|singleFork|VITEST_MAX_(?:THREADS|FORKS)/;

/** A line that names the old option in order to say it is gone. */
const NEGATIVE_NOTE = /removed|not in|renamed/i;

export interface V3Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** Lines naming a v3 option without a removed/not in/renamed note on the same line. */
export const findV3Names = (file: string, text: string): readonly V3Hit[] =>
  text
    .split("\n")
    .flatMap((line, i): readonly V3Hit[] =>
      V3_NAMES.test(line) && !NEGATIVE_NOTE.test(line)
        ? [{ file, line: i + 1, text: line.trim() }]
        : [],
    );

export const formatV3Hits = (hits: readonly V3Hit[]): string | undefined =>
  hits.length === 0
    ? undefined
    : [
        "Vitest 3 option names found without a 'removed', 'not in' or 'renamed' note on the same line",
        "(Vitest 4+ uses maxWorkers / VITEST_MAX_WORKERS; see plugins/vitest/skills/flaky-tests/SKILL.md):",
        ...hits.map((h) => `  ${h.file}:${String(h.line)}: ${h.text}`),
      ].join("\n");

export const formatMissingFlags = (
  missing: readonly { readonly file: string; readonly flag: string }[],
): string | undefined =>
  missing.length === 0
    ? undefined
    : [
        "Documented flags missing from `vitest --help --expand-help` on the pinned version:",
        ...missing.map((m) => `  ${m.file}: ${m.flag}`),
      ].join("\n");
