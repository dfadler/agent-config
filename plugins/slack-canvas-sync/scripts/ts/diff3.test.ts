import assert from "node:assert/strict";
import { test } from "vitest";
import { diff3, diff3Scalar, type Chunk, type ChunkKind } from "./diff3.ts";

function kinds(base: string[], local: string[], remote: string[]): ChunkKind[] {
  return diff3(base, local, remote).map((chunk) => chunk.kind);
}

function words(text: string): string[] {
  return text === "" ? [] : text.split(" ");
}

test("identical inputs are one same chunk", () => {
  assert.deepEqual(diff3(words("a b c"), words("a b c"), words("a b c")), [
    {
      kind: "same",
      base: { start: 0, end: 3 },
      local: { start: 0, end: 3 },
      remote: { start: 0, end: 3 },
    },
  ]);
});

test("empty inputs produce no chunks", () => {
  assert.deepEqual(diff3([], [], []), []);
});

test("a local-only edit is a push chunk", () => {
  assert.deepEqual(kinds(words("a b c"), words("a X c"), words("a b c")), [
    "same",
    "push",
    "same",
  ]);
});

test("a remote-only edit is a pull chunk", () => {
  assert.deepEqual(kinds(words("a b c"), words("a b c"), words("a b Y")), [
    "same",
    "pull",
  ]);
});

test("edits to different sections on each side do not conflict", () => {
  assert.deepEqual(kinds(words("a b c"), words("X b c"), words("a b Y")), [
    "push",
    "same",
    "pull",
  ]);
});

test("different edits to the same section conflict", () => {
  assert.deepEqual(kinds(words("a b c"), words("a X c"), words("a Y c")), [
    "same",
    "conflict",
    "same",
  ]);
});

test("identical edits on both sides converge", () => {
  assert.deepEqual(kinds(words("a b c"), words("a X c"), words("a X c")), [
    "same",
    "converged",
    "same",
  ]);
});

test("insertions and deletions are classified like edits", () => {
  assert.deepEqual(kinds(words("a b c"), words("a b N c"), words("a b c")), [
    "same",
    "push",
    "same",
  ]);
  assert.deepEqual(kinds(words("a b c"), words("a c"), words("a b c")), [
    "same",
    "push",
    "same",
  ]);
  assert.deepEqual(kinds(words("a b c"), words("a b c"), words("a c")), [
    "same",
    "pull",
    "same",
  ]);
});

test("a delete on one side and an edit of the same section on the other conflict", () => {
  assert.deepEqual(kinds(words("a b c"), words("a c"), words("a X c")), [
    "same",
    "conflict",
    "same",
  ]);
});

test("a first sync with no base: one-sided content pushes or pulls", () => {
  assert.deepEqual(kinds([], words("a b"), []), ["push"]);
  assert.deepEqual(kinds([], [], words("a b")), ["pull"]);
});

test("a first sync with no base: differing content on both sides conflicts", () => {
  assert.deepEqual(kinds([], words("a b"), words("a c")), ["conflict"]);
  assert.deepEqual(kinds([], words("a b"), words("a b")), ["converged"]);
});

test("duplicate sections still diff sensibly", () => {
  assert.deepEqual(kinds(words("a a a"), words("a a a a"), words("a a a")), [
    "same",
    "push",
  ]);
});

test("a diff too large to table is refused rather than exhausting memory", () => {
  const big = (prefix: string): string[] =>
    Array.from({ length: 8000 }, (_, i) => `${prefix}${String(i)}`);
  assert.throws(() => diff3(big("a"), big("b"), big("a")), /diff too large/);
});

test("diff3Scalar mirrors the chunk rules", () => {
  assert.equal(diff3Scalar("a", "a", "a"), "same");
  assert.equal(diff3Scalar("a", "a", "b"), "pull");
  assert.equal(diff3Scalar("a", "b", "a"), "push");
  assert.equal(diff3Scalar("a", "b", "b"), "converged");
  assert.equal(diff3Scalar("a", "b", "c"), "conflict");
  assert.equal(diff3Scalar(null, "t", null), "push");
});

// --- properties over small random inputs (seeded, so failures reproduce) ---

function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomList(rand: () => number, max: number): string[] {
  const length = Math.floor(rand() * max);
  return Array.from({ length }, () => String.fromCharCode(97 + Math.floor(rand() * 4)));
}

function mutate(rand: () => number, list: string[]): string[] {
  const out = [...list];
  const edits = Math.floor(rand() * 3);
  for (let k = 0; k < edits; k += 1) {
    const at = Math.floor(rand() * (out.length + 1));
    const roll = rand();
    if (roll < 0.34) out.splice(at, 0, `n${String(Math.floor(rand() * 5))}`);
    else if (roll < 0.67) out.splice(at, 1);
    else out.splice(at, 1, `e${String(Math.floor(rand() * 5))}`);
  }
  return out;
}

function covers(chunks: Chunk[], pick: (c: Chunk) => { start: number; end: number }, length: number): boolean {
  let at = 0;
  for (const chunk of chunks) {
    const range = pick(chunk);
    if (range.start !== at || range.end < range.start) return false;
    at = range.end;
  }
  return at === length;
}

test("property: chunks tile base, local and remote exactly once", () => {
  const rand = prng(12345);
  for (let n = 0; n < 500; n += 1) {
    const base = randomList(rand, 9);
    const local = mutate(rand, base);
    const remote = mutate(rand, base);
    const chunks = diff3(base, local, remote);
    assert.ok(covers(chunks, (c) => c.base, base.length), "base");
    assert.ok(covers(chunks, (c) => c.local, local.length), "local");
    assert.ok(covers(chunks, (c) => c.remote, remote.length), "remote");
  }
});

test("property: a side that did not change takes the other side's version", () => {
  const rand = prng(777);
  for (let n = 0; n < 500; n += 1) {
    const base = randomList(rand, 9);
    const changed = mutate(rand, base);
    for (const [local, remote, expected] of [
      [base, changed, "pull"],
      [changed, base, "push"],
    ] as const) {
      const chunks = diff3(base, local, remote);
      assert.ok(
        chunks.every((c) => c.kind === "same" || c.kind === expected),
        `unexpected kind for ${JSON.stringify({ base, local, remote })}`,
      );
    }
  }
});

test("property: chunk kinds agree with the slices they cover", () => {
  const rand = prng(99);
  for (let n = 0; n < 500; n += 1) {
    const base = randomList(rand, 9);
    const local = mutate(rand, base);
    const remote = mutate(rand, base);
    for (const chunk of diff3(base, local, remote)) {
      const b = base.slice(chunk.base.start, chunk.base.end);
      const l = local.slice(chunk.local.start, chunk.local.end);
      const r = remote.slice(chunk.remote.start, chunk.remote.end);
      const eq = (x: string[], y: string[]): boolean => JSON.stringify(x) === JSON.stringify(y);
      if (chunk.kind === "same") assert.ok(eq(b, l) && eq(b, r));
      if (chunk.kind === "push") assert.ok(eq(b, r) && !eq(b, l));
      if (chunk.kind === "pull") assert.ok(eq(b, l) && !eq(b, r));
      if (chunk.kind === "converged") assert.ok(eq(l, r) && !eq(b, l));
      if (chunk.kind === "conflict") assert.ok(!eq(b, l) && !eq(b, r) && !eq(l, r));
    }
  }
});
