/**
 * Three-way diff over ordered lists of section hashes.
 *
 * `base` is what the last sync recorded, `local` is the file now, `remote` is
 * the canvas now. Sections are matched by content hash and position (never by
 * Slack section ID, which carries no promise of lasting), then the regions
 * between the sections all three sides still agree on are classified.
 */

/** Half-open index range `[start, end)`. */
export interface Range {
  start: number;
  end: number;
}

export type ChunkKind =
  /** All three sides agree. */
  | "same"
  /** Only local changed: apply to the canvas. */
  | "push"
  /** Only the canvas changed: apply to the local file. */
  | "pull"
  /** Both changed, to identical content: nothing to apply. */
  | "converged"
  /** Both changed, differently: needs a human. */
  | "conflict";

export interface Chunk {
  kind: ChunkKind;
  base: Range;
  local: Range;
  remote: Range;
}

/** Above this many DP cells the diff refuses rather than exhausting memory. */
const MAX_LCS_CELLS = 50_000_000;

function sameItems(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * For each index of `a`, the index of the matching item in `b` (or -1), from a
 * longest common subsequence. Common prefix and suffix are matched first so
 * the quadratic table only covers the part that actually changed.
 */
function matchIndices(a: string[], b: string[]): number[] {
  const match = new Array<number>(a.length).fill(-1);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    match[prefix] = prefix;
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    match[a.length - 1 - suffix] = b.length - 1 - suffix;
    suffix += 1;
  }

  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  if (n === 0 || m === 0) return match;
  if ((n + 1) * (m + 1) > MAX_LCS_CELLS) {
    throw new Error(
      `diff too large: ${String(n)} x ${String(m)} changed sections`,
    );
  }

  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[prefix + i] === b[prefix + j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(
              table[(i + 1) * width + j] ?? 0,
              table[i * width + j + 1] ?? 0,
            );
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[prefix + i] === b[prefix + j]) {
      match[prefix + i] = prefix + j;
      i += 1;
      j += 1;
    } else if (
      (table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)
    ) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return match;
}

function classify(base: string[], local: string[], remote: string[]): ChunkKind {
  const localSame = sameItems(base, local);
  const remoteSame = sameItems(base, remote);
  if (localSame && remoteSame) return "same";
  if (localSame) return "pull";
  if (remoteSame) return "push";
  if (sameItems(local, remote)) return "converged";
  return "conflict";
}

/**
 * Split the three sequences into consecutive chunks covering all of them.
 * Every index of each list falls in exactly one chunk.
 */
export function diff3(
  base: string[],
  local: string[],
  remote: string[],
): Chunk[] {
  const toLocal = matchIndices(base, local);
  const toRemote = matchIndices(base, remote);

  const chunks: Chunk[] = [];
  const emit = (b: Range, l: Range, r: Range, kind: ChunkKind): void => {
    const last = chunks[chunks.length - 1];
    if (
      kind === "same" &&
      last?.kind === "same" &&
      last.base.end === b.start &&
      last.local.end === l.start &&
      last.remote.end === r.start
    ) {
      last.base.end = b.end;
      last.local.end = l.end;
      last.remote.end = r.end;
      return;
    }
    chunks.push({ kind, base: b, local: l, remote: r });
  };

  let b = 0;
  let l = 0;
  let r = 0;
  const flush = (bEnd: number, lEnd: number, rEnd: number): void => {
    if (b === bEnd && l === lEnd && r === rEnd) return;
    const kind = classify(
      base.slice(b, bEnd),
      local.slice(l, lEnd),
      remote.slice(r, rEnd),
    );
    emit(
      { start: b, end: bEnd },
      { start: l, end: lEnd },
      { start: r, end: rEnd },
      kind,
    );
  };

  for (let i = 0; i < base.length; i += 1) {
    const li = toLocal[i] ?? -1;
    const ri = toRemote[i] ?? -1;
    if (li === -1 || ri === -1) continue;
    flush(i, li, ri);
    emit(
      { start: i, end: i + 1 },
      { start: li, end: li + 1 },
      { start: ri, end: ri + 1 },
      "same",
    );
    b = i + 1;
    l = li + 1;
    r = ri + 1;
  }
  flush(base.length, local.length, remote.length);
  return chunks;
}

/** Three-way merge of a single value (e.g. the canvas title). */
export function diff3Scalar<T>(
  base: T,
  local: T,
  remote: T,
): ChunkKind {
  if (local === base && remote === base) return "same";
  if (local === base) return "pull";
  if (remote === base) return "push";
  if (local === remote) return "converged";
  return "conflict";
}
