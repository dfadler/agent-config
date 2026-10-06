/** Reads the CLI's console output for the few messages the wrapper acts on. */

export interface OutputSignals {
  /** "plugin eval is currently in early access": the account lacks the feature. Not a plugin regression. */
  readonly earlyAccess: boolean;
  /** "currently unavailable": the feature is down. Not a plugin regression. */
  readonly unavailable: boolean;
  /** Lines of the CLI's own preflight warning ("cannot pass with the granted tools"). */
  readonly cannotPass: readonly string[];
}

/**
 * Scan combined stdout and stderr. The preflight warning is matched whatever
 * the exit code, because the CLI may print it and still carry on.
 * UNCONFIRMED: whether it appears before authentication (#450 item 2); a
 * surfaced warning is treated as an error either way.
 */
export const scanOutput = (text: string): OutputSignals => ({
  earlyAccess: /plugin eval is currently in early access/i.test(text),
  unavailable: /currently unavailable/i.test(text),
  cannotPass: text
    .split(/\r?\n/)
    .filter((l) => /cannot pass with the granted tools/i.test(l))
    .map((l) => l.trim()),
});
