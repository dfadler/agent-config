/**
 * Exit codes of the run wrapper. The first block is the repo's shared taxonomy
 * (plugins/shell-script-hygiene/SKILL.md), copied here because a plugin
 * is installed on its own and must not import from `scripts/ts/lib/`. The
 * second block is the part of the taxonomy a `claude plugin eval` wrapper adds
 * (EXIT_PARTIAL in the reserved gap, plus the two signal codes); the shared
 * list has them too.
 */

/** Success: every run group passed and its results are trustworthy. */
export const EXIT_OK = 0;
/** The CLI ran and found something wrong (score below threshold, no cases, bad option). */
export const EXIT_FAILURE = 1;
/** The wrapper itself was called wrongly. */
export const EXIT_USAGE = 2;
/** Bad configuration: unreadable cases or grants file, or the CLI says a case cannot pass with its grants. */
export const EXIT_CONFIG = 3;
/** A requirement is unmet: Claude Code or git too old, a sandbox backend missing, or plugin eval unavailable. */
export const EXIT_DEPENDENCY = 4;
/** Unexpected failure; should not happen. */
export const EXIT_INTERNAL = 20;

/**
 * A partial or untrustworthy run: cost ceiling hit, credential rejected, a
 * run errored (a usage or rate limit mid-suite is not marked `partial` by the
 * CLI), or paid graders were skipped. Not the CLI's own code 2, which the
 * wrapper reads and re-maps (2 is `EXIT_USAGE` in the shared taxonomy).
 */
export const EXIT_PARTIAL = 7;
/** The CLI was interrupted (130, the shell convention for SIGINT). */
export const EXIT_INTERRUPTED = 130;
/** The CLI was terminated (143, the shell convention for SIGTERM). */
export const EXIT_TERMINATED = 143;

/** Every code the wrapper can exit with. */
export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_FAILURE
  | typeof EXIT_USAGE
  | typeof EXIT_CONFIG
  | typeof EXIT_DEPENDENCY
  | typeof EXIT_INTERNAL
  | typeof EXIT_PARTIAL
  | typeof EXIT_INTERRUPTED
  | typeof EXIT_TERMINATED;

/**
 * Severity order for combining several run groups into one exit code: the
 * later entry wins. A code that stops the wrapper (interrupt, terminate)
 * outranks everything.
 */
const SEVERITY: readonly ExitCode[] = [
  EXIT_OK,
  EXIT_FAILURE,
  EXIT_PARTIAL,
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_USAGE,
  EXIT_INTERNAL,
  EXIT_INTERRUPTED,
  EXIT_TERMINATED,
];

/** The more severe of two codes. */
export const worstExit = (a: ExitCode, b: ExitCode): ExitCode =>
  SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
