/** Human-readable text for a caught value, which need not be an `Error`. */
export const describeThrown = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);
