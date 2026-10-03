/** Minimal dotted-version parsing for the preflight checks. */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Oldest Claude Code that has `claude plugin eval`. */
export const MIN_CLAUDE_VERSION: Version = { major: 2, minor: 1, patch: 269 };
/** Oldest git the CLI supports, when git is installed. */
export const MIN_GIT_VERSION: Version = { major: 2, minor: 31, patch: 0 };

export const formatVersion = (v: Version): string =>
  `${String(v.major)}.${String(v.minor)}.${String(v.patch)}`;

/**
 * The first `X.Y` or `X.Y.Z` in `text` (`2.1.287 (Claude Code)`,
 * `git version 2.39.3 (Apple Git-145)`), or undefined when there is none.
 */
export const parseVersion = (text: string): Version | undefined => {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  if (m === null) return undefined;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3] ?? "0"),
  };
};

/** True when `v` is `min` or newer. */
export const atLeast = (v: Version, min: Version): boolean =>
  v.major !== min.major
    ? v.major > min.major
    : v.minor !== min.minor
      ? v.minor > min.minor
      : v.patch >= min.patch;
