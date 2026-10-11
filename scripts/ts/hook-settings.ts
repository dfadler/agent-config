// Pure edits to the `hooks` section of a ~/.claude/settings.json document.
// teardown.ts is the TypeScript caller; scripts/settings-lib.sh (python3) is
// the bootstrap-bash counterpart with the same removal semantics.

export type JsonObject = Readonly<Record<string, unknown>>;

export const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Remove every hook under `hooks.<event>` for which `isTarget` is true.
 * An entry is dropped only when THIS removal emptied it (a foreign entry that
 * was already empty is kept); the event key goes when no entries remain.
 * Returns the new document, or `undefined` when nothing matched (so the
 * caller can skip the write).
 */
export const deregisterHook = (
  data: JsonObject,
  event: string,
  isTarget: (hook: JsonObject) => boolean,
): JsonObject | undefined => {
  const hooks = data["hooks"];
  if (!isRecord(hooks)) return undefined;
  const entries = hooks[event];
  if (!Array.isArray(entries)) return undefined;

  let removed = false;
  const kept: unknown[] = [];
  const list: readonly unknown[] = entries;
  for (const entry of list) {
    if (!isRecord(entry) || !Array.isArray(entry["hooks"])) {
      kept.push(entry);
      continue;
    }
    const original: readonly unknown[] = entry["hooks"];
    const remaining = original.filter((h) => !(isRecord(h) && isTarget(h)));
    const changed = remaining.length < original.length;
    removed ||= changed;
    if (remaining.length > 0 || !changed) kept.push({ ...entry, hooks: remaining });
  }
  if (!removed) return undefined;

  // Rebuild in place so the event keeps its position in the file.
  const nextHooks = Object.fromEntries(
    Object.entries(hooks).flatMap(([k, v]) =>
      k !== event ? [[k, v]] : kept.length > 0 ? [[k, kept]] : [],
    ),
  );
  return { ...data, hooks: nextHooks };
};
