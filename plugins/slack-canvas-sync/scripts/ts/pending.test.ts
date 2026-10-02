import assert from "node:assert/strict";
import { test } from "vitest";
import { emptyManifest, snapshotFile, type Manifest } from "./manifest.ts";
import {
  DELETE_STEPS,
  PendingError,
  addPending,
  isScratchTitle,
  resolvePending,
  retireFile,
} from "./pending.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function manifestWith(path: string, canvasUrl?: string): Manifest {
  const manifest = emptyManifest();
  manifest.files[path] = {
    ...snapshotFile({ canvasId: "F1", title: "Note", sections: ["a"], now: NOW }),
    ...(canvasUrl === undefined ? {} : { canvas_url: canvasUrl }),
  };
  return manifest;
}

test("scratch titles are recognized by their prefix", () => {
  assert.equal(isScratchTitle("[agent-sync-scratch] sync test"), true);
  assert.equal(isScratchTitle("Real note"), false);
  assert.equal(isScratchTitle(null), false);
});

test("addPending records the canvas once, with a link only when given", () => {
  const manifest = emptyManifest();
  assert.equal(
    addPending(manifest, { canvasId: "F1", title: "T", reason: "test" }, NOW),
    true,
  );
  assert.equal(
    addPending(
      manifest,
      { canvasId: "F1", title: "T", reason: "superseded", canvasUrl: "https://x/F1" },
      NOW,
    ),
    false,
  );
  addPending(
    manifest,
    { canvasId: "F2", title: null, reason: "superseded", canvasUrl: "https://x/F2" },
    NOW,
  );
  assert.deepEqual(manifest.pending_manual_deletion, [
    { canvas_id: "F1", title: "T", reason: "test", added_at: NOW },
    { canvas_id: "F2", title: null, reason: "superseded", added_at: NOW, canvas_url: "https://x/F2" },
  ]);
});

test("resolvePending clears an entry and reports whether it existed", () => {
  const manifest = emptyManifest();
  addPending(manifest, { canvasId: "F1", title: "T", reason: "test" }, NOW);
  assert.equal(resolvePending(manifest, "F9"), false);
  assert.equal(resolvePending(manifest, "F1"), true);
  assert.deepEqual(manifest.pending_manual_deletion, []);
});

test("retireFile stops tracking the file and flags its canvas, keeping the link", () => {
  const manifest = manifestWith("notes/a.md", "https://x/F1");
  const item = retireFile(manifest, "notes/a.md", "local-file-removed", NOW);
  assert.deepEqual(manifest.files, {});
  assert.deepEqual(item, {
    canvas_id: "F1",
    title: "Note",
    reason: "local-file-removed",
    added_at: NOW,
    canvas_url: "https://x/F1",
  });
  assert.equal(manifest.pending_manual_deletion.length, 1);
});

test("retireFile leaves other files alone and does not double-list a canvas", () => {
  const manifest = manifestWith("a.md");
  manifest.files["b.md"] = snapshotFile({ canvasId: "F2", title: null, sections: [], now: NOW });
  addPending(manifest, { canvasId: "F1", title: "Note", reason: "test" }, NOW);
  retireFile(manifest, "a.md", "superseded", NOW);
  assert.deepEqual(Object.keys(manifest.files), ["b.md"]);
  assert.equal(manifest.pending_manual_deletion.length, 1);
  assert.equal(manifest.pending_manual_deletion[0]?.reason, "test");
});

test("retireFile rejects an untracked path", () => {
  assert.throws(
    () => retireFile(emptyManifest(), "nope.md", "superseded", NOW),
    PendingError,
  );
});

test("the delete steps name the Slack menu entry", () => {
  assert.match(DELETE_STEPS, /Delete canvas/);
});
