// Narrowing helpers for untrusted parsed JSON (no type assertions).

/** A plain object's entries as a record; undefined for null, arrays, scalars. */
export const asObject = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : undefined;

/** An array's elements as unknown[]; undefined for anything else. */
export const asArray = (v: unknown): unknown[] | undefined =>
  Array.isArray(v) ? v.map((x: unknown) => x) : undefined;
