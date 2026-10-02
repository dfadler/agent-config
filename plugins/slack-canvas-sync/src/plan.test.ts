import assert from "node:assert/strict";
import { test } from "vitest";
import { FakeCanvas, syncOnce } from "../test/fake-canvas.ts";
import type { FileEntry } from "./manifest.ts";
import { normalizeLocal, renderSections } from "./normalize.ts";

function doc(title: string, ...sections: string[]): string {
  return `# ${title}\n\n${renderSections(sections)}`;
}

/** Sync a fresh file once so tests start from a recorded base. */
function synced(title: string, sections: string[]): {
  canvas: FakeCanvas;
  local: string;
  entry: FileEntry;
} {
  const canvas = new FakeCanvas(title);
  const result = syncOnce(canvas, doc(title, ...sections), null);
  assert.ok(result.entry);
  return { canvas, local: result.localMarkdown, entry: result.entry };
}

test("first sync of a new file inserts everything at the start of an empty canvas", () => {
  const canvas = new FakeCanvas("T");
  const result = syncOnce(canvas, doc("T", "para one", "para two"), null);
  assert.equal(result.plan.status, "push");
  assert.deepEqual(result.applied.ops, [
    { type: "insert_after", afterIndex: -1, text: "para one\n\npara two" },
  ]);
  assert.deepEqual(canvas.texts(), ["para one", "para two"]);
  assert.ok(result.entry);
});

test("an unchanged file is in sync and produces no edits", () => {
  const { canvas, local, entry } = synced("T", ["a", "b"]);
  const result = syncOnce(canvas, local, entry);
  assert.equal(result.plan.status, "in-sync");
  assert.deepEqual(result.applied.ops, []);
});

test("a local edit becomes one replace of the matching canvas section", () => {
  const { canvas, entry } = synced("T", ["a", "b", "c"]);
  const result = syncOnce(canvas, doc("T", "a", "B2", "c"), entry);
  assert.equal(result.plan.status, "push");
  assert.deepEqual(result.applied.ops, [
    { type: "replace", remoteIndex: 1, text: "B2" },
  ]);
  assert.deepEqual(canvas.texts(), ["a", "B2", "c"]);
});

test("a section added locally is inserted after its predecessor", () => {
  const { canvas, entry } = synced("T", ["a", "c"]);
  const result = syncOnce(canvas, doc("T", "a", "b", "c"), entry);
  assert.deepEqual(result.applied.ops, [
    { type: "insert_after", afterIndex: 0, text: "b" },
  ]);
  assert.deepEqual(canvas.texts(), ["a", "b", "c"]);
});

test("a section added at the very top is inserted at the start", () => {
  const { canvas, entry } = synced("T", ["a"]);
  const result = syncOnce(canvas, doc("T", "new", "a"), entry);
  assert.deepEqual(result.applied.ops, [
    { type: "insert_after", afterIndex: -1, text: "new" },
  ]);
  assert.deepEqual(canvas.texts(), ["new", "a"]);
});

test("several sections added in a row stay in order", () => {
  const { canvas, entry } = synced("T", ["a", "z"]);
  syncOnce(canvas, doc("T", "a", "b", "c", "d", "z"), entry);
  assert.deepEqual(canvas.texts(), ["a", "b", "c", "d", "z"]);
});

test("a section removed locally is deleted from the canvas", () => {
  const { canvas, entry } = synced("T", ["a", "b", "c"]);
  const result = syncOnce(canvas, doc("T", "a", "c"), entry);
  assert.deepEqual(result.applied.ops, [{ type: "delete", remoteIndex: 1 }]);
  assert.deepEqual(canvas.texts(), ["a", "c"]);
});

test("a section replaced by several grows the canvas", () => {
  const { canvas, entry } = synced("T", ["a", "b"]);
  syncOnce(canvas, doc("T", "a", "b1", "b2", "b3"), entry);
  assert.deepEqual(canvas.texts(), ["a", "b1", "b2", "b3"]);
});

test("a UI edit is pulled into the local file", () => {
  const { canvas, local, entry } = synced("T", ["a", "b"]);
  canvas.uiEdit(1, "b from slack");
  canvas.uiInsert(2, "added in slack");
  const result = syncOnce(canvas, local, entry);
  assert.equal(result.plan.status, "pull");
  assert.deepEqual(result.applied.ops, []);
  assert.deepEqual(normalizeLocal(result.localMarkdown).sections, [
    "a",
    "b from slack",
    "added in slack",
  ]);
});

test("a UI delete is pulled into the local file", () => {
  const { canvas, local, entry } = synced("T", ["a", "b", "c"]);
  canvas.uiDelete(0);
  const result = syncOnce(canvas, local, entry);
  assert.deepEqual(normalizeLocal(result.localMarkdown).sections, ["b", "c"]);
});

test("edits to different sections on each side both apply", () => {
  const { canvas, entry } = synced("T", ["a", "b", "c"]);
  canvas.uiEdit(2, "c from slack");
  const result = syncOnce(canvas, doc("T", "A local", "b", "c"), entry);
  assert.equal(result.plan.status, "mixed");
  assert.deepEqual(canvas.texts(), ["A local", "b", "c from slack"]);
  assert.deepEqual(normalizeLocal(result.localMarkdown).sections, [
    "A local",
    "b",
    "c from slack",
  ]);
});

test("different edits to one section are a conflict and write nothing", () => {
  const { canvas, entry } = synced("T", ["a", "b", "c"]);
  canvas.uiEdit(1, "b from slack");
  const local = doc("T", "a", "b local", "c");
  const result = syncOnce(canvas, local, entry);
  assert.equal(result.plan.status, "conflict");
  assert.equal(result.entry, null);
  assert.equal(result.localMarkdown, local);
  assert.deepEqual(canvas.texts(), ["a", "b from slack", "c"]);
  const [conflict] = result.applied.conflicts;
  assert.ok(conflict);
  assert.deepEqual(conflict.local, ["b local"]);
  assert.deepEqual(conflict.remote, ["b from slack"]);
});

test("the same edit made on both sides needs no work", () => {
  const { canvas, entry } = synced("T", ["a", "b"]);
  canvas.uiEdit(1, "same");
  const result = syncOnce(canvas, doc("T", "a", "same"), entry);
  assert.equal(result.plan.status, "in-sync");
  assert.deepEqual(result.applied.ops, []);
  assert.deepEqual(result.entry?.sections.length, 2);
});

test("renaming locally renames the canvas", () => {
  const { canvas, entry } = synced("Old", ["a"]);
  const result = syncOnce(canvas, doc("New", "a"), entry);
  assert.deepEqual(result.applied.ops, [{ type: "rename", title: "New" }]);
  assert.equal(canvas.title, "New");
});

test("renaming in Slack renames the local title", () => {
  const { canvas, local, entry } = synced("Old", ["a"]);
  canvas.title = "From Slack";
  const result = syncOnce(canvas, local, entry);
  assert.equal(normalizeLocal(result.localMarkdown).title, "From Slack");
});

test("different renames on each side are a title conflict", () => {
  const { canvas, entry } = synced("Old", ["a"]);
  canvas.title = "Slack name";
  const result = syncOnce(canvas, doc("Local name", "a"), entry);
  assert.equal(result.plan.status, "conflict");
  assert.deepEqual(result.applied.titleConflict, {
    local: "Local name",
    remote: "Slack name",
  });
  assert.equal(canvas.title, "Slack name");
});

test("a file with no title never renames the canvas", () => {
  const { canvas, entry } = synced("T", ["a"]);
  const result = syncOnce(canvas, "a\n", { ...entry, title: null });
  assert.equal(result.applied.ops.some((op) => op.type === "rename"), false);
});

test("first sync where both sides already differ is a conflict", () => {
  const canvas = new FakeCanvas("T", ["already there"]);
  const result = syncOnce(canvas, doc("T", "my version"), null);
  assert.equal(result.plan.status, "conflict");
  assert.deepEqual(canvas.texts(), ["already there"]);
});

test("applying ops to a canvas that changed since the read is refused", () => {
  const canvas = new FakeCanvas("T", ["a"]);
  const { sectionIds } = canvas.read();
  canvas.uiInsert(0, "sneaky");
  assert.throws(() => {
    canvas.apply([{ type: "delete", remoteIndex: 0 }], sectionIds);
  }, /changed since it was read/);
});

test("the fake rejects UI edits to sections that do not exist", () => {
  assert.throws(() => {
    new FakeCanvas("T").uiEdit(0, "x");
  }, RangeError);
});

// --- fuzz: random edits on both sides always converge or conflict cleanly ---

function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

test("fuzz: after any non-conflicting sync both sides match and a re-sync is a no-op", () => {
  const rand = prng(2026);
  let converged = 0;
  let conflicts = 0;
  for (let n = 0; n < 300; n += 1) {
    const count = 1 + Math.floor(rand() * 6);
    const base = Array.from({ length: count }, (_, i) => `section ${String(i)}`);
    const { canvas, local, entry } = synced("T", base);

    const localSections = [...base];
    for (let k = Math.floor(rand() * 3); k > 0; k -= 1) {
      const at = Math.floor(rand() * (localSections.length + 1));
      const roll = rand();
      if (roll < 0.4) localSections.splice(at, 0, `local new ${String(n)}-${String(k)}`);
      else if (roll < 0.7 && localSections.length > 0) localSections.splice(at % localSections.length, 1);
      else if (localSections.length > 0) localSections.splice(at % localSections.length, 1, `local edit ${String(n)}-${String(k)}`);
    }
    for (let k = Math.floor(rand() * 3); k > 0; k -= 1) {
      const size = canvas.texts().length;
      const at = Math.floor(rand() * (size + 1));
      const roll = rand();
      if (roll < 0.4) canvas.uiInsert(at, `remote new ${String(n)}-${String(k)}`);
      else if (roll < 0.7 && size > 0) canvas.uiDelete(at % size);
      else if (size > 0) canvas.uiEdit(at % size, `remote edit ${String(n)}-${String(k)}`);
    }

    const before = canvas.texts();
    const result = syncOnce(canvas, doc("T", ...localSections), entry);
    if (result.plan.status === "conflict") {
      conflicts += 1;
      assert.deepEqual(canvas.texts(), before, "a conflict must not touch the canvas");
      continue;
    }
    converged += 1;
    assert.ok(result.entry);
    assert.deepEqual(
      normalizeLocal(result.localMarkdown).sections,
      canvas.texts(),
      `local and canvas differ after sync (case ${String(n)}, from ${String(local.length)} chars)`,
    );
    const again = syncOnce(canvas, result.localMarkdown, result.entry);
    assert.equal(again.plan.status, "in-sync");
    assert.deepEqual(again.applied.ops, []);
  }
  assert.ok(converged > 50, `only ${String(converged)} runs converged`);
  assert.ok(conflicts > 5, `only ${String(conflicts)} conflicts exercised`);
});
