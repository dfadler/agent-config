import assert from "node:assert/strict";
import { test } from "vitest";
import {
  ManifestError,
  bodyHash,
  emptyManifest,
  parseManifest,
  readManifest,
  snapshotFile,
  writeManifest,
  type Manifest,
} from "./manifest.ts";

function sample(): Manifest {
  return {
    version: 1,
    workspace: "example.slack.com",
    files: {
      "b/two.md": snapshotFile({
        canvasId: "F2",
        title: "Two",
        sections: ["x", "y"],
        now: "2026-01-01T00:00:00.000Z",
      }),
      "a/one.md": snapshotFile({
        canvasId: "F1",
        title: null,
        sections: ["z"],
        sectionIds: ["temp:C:VLO1"],
        now: "2026-01-02T00:00:00.000Z",
      }),
    },
    pending_manual_deletion: [
      {
        canvas_id: "F9",
        title: "[agent-sync-scratch] t",
        reason: "test",
        added_at: "2026-01-03T00:00:00.000Z",
      },
    ],
  };
}

test("empty text reads as an empty manifest", () => {
  assert.deepEqual(readManifest(""), emptyManifest());
  assert.deepEqual(readManifest("  \n"), emptyManifest());
});

test("a manifest round-trips through write and read", () => {
  const manifest = sample();
  assert.deepEqual(readManifest(writeManifest(manifest)), manifest);
});

test("serialization sorts file keys and ends with a newline", () => {
  const text = writeManifest(sample());
  assert.ok(text.endsWith("}\n"));
  assert.ok(text.indexOf('"a/one.md"') < text.indexOf('"b/two.md"'));
});

test("snapshotFile records hashes, not content", () => {
  const entry = snapshotFile({
    canvasId: "F1",
    title: "T",
    sections: ["secret text"],
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(entry.sections.length, 1);
  assert.equal(entry.body_hash, bodyHash(["secret text"]));
  assert.equal(JSON.stringify(entry).includes("secret text"), false);
});

test("section ids are optional per section", () => {
  const entry = snapshotFile({
    canvasId: "F1",
    title: null,
    sections: ["a", "b"],
    sectionIds: ["temp:C:VLO1"],
    now: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(entry.sections[0]?.section_id, "temp:C:VLO1");
  assert.equal("section_id" in (entry.sections[1] ?? {}), false);
});

test("invalid JSON is a ManifestError", () => {
  assert.throws(() => readManifest("{nope"), ManifestError);
});

test("shape violations are rejected with a located message", () => {
  const good: unknown = JSON.parse(writeManifest(sample()));
  assert.ok(good !== null);
  const cases: [string, (m: Record<string, unknown>) => void, RegExp][] = [
    ["wrong version", (m) => { m["version"] = 2; }, /version must be 1/],
    ["files not an object", (m) => { m["files"] = []; }, /files must be an object/],
    ["pending not an array", (m) => { m["pending_manual_deletion"] = {}; }, /pending_manual_deletion must be an array/],
    ["workspace not a string", (m) => { m["workspace"] = 5; }, /workspace must be a string or null/],
    ["entry not an object", (m) => { m["files"] = { "a.md": 1 }; }, /files\["a.md"\] must be an object/],
    ["sections not an array", (m) => { m["files"] = { "a.md": { canvas_id: "F", sections: 1 } }; }, /sections must be an array/],
    ["section not an object", (m) => { m["files"] = { "a.md": { canvas_id: "F", title: null, body_hash: "h", last_synced_at: "t", sections: [1] } }; }, /sections\[0\] must be an object/],
    ["missing canvas_id", (m) => { m["files"] = { "a.md": { sections: [] } }; }, /canvas_id must be a non-empty string/],
    ["bad deletion reason", (m) => { m["pending_manual_deletion"] = [{ canvas_id: "F", title: null, reason: "because", added_at: "t" }]; }, /reason "because" is not recognized/],
    ["pending not an object", (m) => { m["pending_manual_deletion"] = [3]; }, /pending_manual_deletion\[0\] must be an object/],
  ];
  for (const [name, break_, pattern] of cases) {
    const copy: unknown = JSON.parse(JSON.stringify(good));
    assert.ok(typeof copy === "object" && copy !== null && !Array.isArray(copy));
    const record: Record<string, unknown> = { ...copy };
    break_(record);
    assert.throws(() => parseManifest(record), pattern, name);
  }
  assert.throws(() => parseManifest(null), /must be an object/);
  assert.throws(() => parseManifest([]), /must be an object/);
});
