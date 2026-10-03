/**
 * The repo's exit-code taxonomy (claude/conventions/shell-script-hygiene.md),
 * restated here because a plugin is installed on its own and must not import
 * from the repo's `scripts/ts/lib/` (docs/testing.md). Same numbers, only the
 * codes this CLI uses.
 */

/** No error findings. */
export const EXIT_OK = 0;
/** The check ran and found an error. */
export const EXIT_FAILURE = 1;
/** Missing or invalid arguments, including a bad path argument. */
export const EXIT_USAGE = 2;
/** Bad config (the manifest's eval directory). */
export const EXIT_CONFIG = 3;
/** Unexpected failure; should not happen. */
export const EXIT_INTERNAL = 20;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_FAILURE
  | typeof EXIT_USAGE
  | typeof EXIT_CONFIG
  | typeof EXIT_INTERNAL;
