/**
 * The repo's shell exit-code taxonomy, as typed constants. Same numbers and
 * meanings as claude/conventions/shell-script-hygiene.md so a TypeScript check
 * and the shell script it replaces are interchangeable to callers. The gap
 * between 6 and 20 is deliberate headroom; do not invent codes without
 * extending that list first.
 */

/** Success. */
export const EXIT_OK = 0;
/** General failure: the check ran and found something wrong. */
export const EXIT_FAILURE = 1;
/** Missing or invalid arguments, including a bad path argument. */
export const EXIT_USAGE = 2;
/** Bad config. */
export const EXIT_CONFIG = 3;
/** A required external command is not on PATH. */
export const EXIT_DEPENDENCY = 4;
/** Network failure. */
export const EXIT_NETWORK = 5;
/** Operation timed out. */
export const EXIT_TIMEOUT = 6;
/** Unexpected or assertion failure; should not happen. */
export const EXIT_INTERNAL = 20;

/** A failure code: every code except success. */
export type FailureCode =
  | typeof EXIT_FAILURE
  | typeof EXIT_USAGE
  | typeof EXIT_CONFIG
  | typeof EXIT_DEPENDENCY
  | typeof EXIT_NETWORK
  | typeof EXIT_TIMEOUT
  | typeof EXIT_INTERNAL;

/** Any code in the taxonomy. */
export type ExitCode = typeof EXIT_OK | FailureCode;

/**
 * The `err` side of a CLI `Result`: what to print to stderr and which
 * non-zero code to exit with.
 */
export interface CliError {
  readonly code: FailureCode;
  readonly message: string;
}

/** Build a `CliError`. */
export const cliError = (code: FailureCode, message: string): CliError => ({
  code,
  message,
});
