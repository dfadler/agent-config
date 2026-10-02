import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll as after, test } from "vitest";
import { FakeCanvas } from "../test/fake-canvas.ts";
import { normalizeSections } from "./normalize.ts";
import {
  STATE_DIR,
  SyncError,
  checkRelPath,
  defaultTitle,
  listMarkdown,
  loadManifest,
  pendingAdd,
  pendingList,
  pendingResolve,
  planPush,
  pullStep,
  readFingerprint,
  recordStep,
  retirePath,
  scan,
  trackedInGit,
  type PlanResult,
  type RecordResult,
} from "./sync-fs.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const made: string[] = [];

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "canvas-sync-test-"));
  made.push(dir);
  return dir;
}

function makeRoot(files: Record<string, string>): string {
  const root = tmp();
  for (const [rel, text] of Object.entries(files)) writeFile(root, rel, text);
  return root;
}

function writeFile(root: string, rel: string, text: string): void {
  const target = join(root, ...rel.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, "utf8");
}

function readFile(root: string, rel: string): string {
  return readFileSync(join(root, ...rel.split("/")), "utf8");
}

interface PushOutcome {
  plan: PlanResult;
  canvas: FakeCanvas | null;
  record: RecordResult | null;
}

/** Drive one push the way the skill does: plan, apply to the canvas, record. */
function push(root: string, rel: string, canvas: FakeCanvas | null): PushOutcome {
  const plan = planPush(root, rel, canvas === null ? null : canvas.readResult());
  if (plan.blocked !== null) return { plan, canvas, record: null };
  let target = canvas;
  if (plan.create !== null) {
    target = new FakeCanvas(plan.create.title, normalizeSections(plan.create.content));
  } else {
    for (const batch of plan.batches) target?.applyUpdate(batch);
  }
  assert.ok(target);
  return { plan, canvas: target, record: recordStep(root, rel, target.readResult(), "push", NOW) };
}

const NOTE = "# Note\n\nfirst paragraph\n\n- a\n- b\n\nlast paragraph\n";

test("checkRelPath accepts plain relative .md paths only", () => {
  assert.equal(checkRelPath("a/b.md"), "a/b.md");
  for (const bad of ["", "/abs.md", "../x.md", "a/../x.md", "./x.md", "a//b.md", "a\\b.md", "a.txt", `${STATE_DIR}/manifest.md`]) {
    assert.throws(() => checkRelPath(bad), SyncError, bad);
  }
});

test("defaultTitle uses the file name, or the folder for an index file", () => {
  assert.equal(defaultTitle("notes/ideas.md"), "ideas");
  assert.equal(defaultTitle("projects/alpha/index.md"), "alpha");
  assert.equal(defaultTitle("index.md"), "Index");
});

test("listMarkdown finds .md files, skips dot-directories, and sorts", () => {
  const root = makeRoot({
    "b.md": "x",
    "a/c.md": "x",
    "a/notes.txt": "x",
    ".hidden/d.md": "x",
    [`${STATE_DIR}/e.md`]: "x",
  });
  assert.deepEqual(listMarkdown(root), ["a/c.md", "b.md"]);
});

test("a missing sync root is an error", () => {
  assert.throws(() => scan(join(tmp(), "nope")), /does not exist/);
});

test("scan reports new files, opted-out files, and validation errors", () => {
  const root = makeRoot({
    "new.md": NOTE,
    "off.md": "---\ncanvas_sync: false\n---\ntext\n",
    "bad.md": "* a\n  # nope\n",
  });
  const result = scan(root);
  const byPath = new Map(result.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("new.md")?.state, "new");
  assert.equal(byPath.get("new.md")?.title, "Note");
  assert.equal(byPath.get("off.md")?.sync, false);
  assert.equal(byPath.get("bad.md")?.validation_errors, 1);
  assert.deepEqual(result.missing, []);
});

test("the first push creates a canvas and records it", () => {
  const root = makeRoot({ "note.md": NOTE });
  const out = push(root, "note.md", null);
  assert.equal(out.plan.kind, "create");
  assert.equal(out.plan.create?.title, "Note");
  assert.equal(out.record?.recorded, true);
  assert.deepEqual(out.canvas?.texts(), ["first paragraph", "* a\n* b", "last paragraph"]);

  const entry = loadManifest(root).files["note.md"];
  assert.ok(entry);
  assert.equal(entry.canvas_id, "FTEST000001");
  assert.equal(entry.sections.length, 3);
  assert.equal(scan(root).files[0]?.local_changed, false);
});

test("the state directory ignores itself and holds no content", () => {
  const root = makeRoot({ "note.md": "# Note\n\nsecret sentence\n" });
  push(root, "note.md", null);
  assert.equal(readFile(root, `${STATE_DIR}/.gitignore`).includes("*\n"), true);
  assert.equal(readFile(root, `${STATE_DIR}/manifest.json`).includes("secret sentence"), false);
});

test("an unchanged file produces an in-sync plan with no edits", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  const plan = planPush(root, "note.md", canvas?.readResult());
  assert.equal(plan.status, "in-sync");
  assert.deepEqual(plan.batches, []);
  assert.equal(plan.blocked, null);
});

test("a local edit pushes as section edits and the canvas ends up matching", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  writeFile(root, "note.md", NOTE.replace("first paragraph", "first paragraph, edited").replace("- b\n", "- b\n- c\n"));
  assert.equal(scan(root).files[0]?.local_changed, true);

  assert.ok(canvas);
  const out = push(root, "note.md", canvas);
  assert.equal(out.plan.status, "push");
  assert.equal(out.record?.recorded, true);
  assert.deepEqual(canvas.texts(), ["first paragraph, edited", "* a\n* b\n* c", "last paragraph"]);
  assert.equal(planPush(root, "note.md", canvas.readResult()).status, "in-sync");
});

test("a rename pushes to the canvas title", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  writeFile(root, "note.md", NOTE.replace("# Note", "# Renamed"));
  push(root, "note.md", canvas);
  assert.equal(canvas?.title, "Renamed");
});

test("a read fingerprint changes when the canvas does", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  const before = readFingerprint(canvas.readResult());
  assert.equal(before, readFingerprint(canvas.readResult()));
  canvas.uiEdit(0, "someone else typed this");
  assert.notEqual(before, readFingerprint(canvas.readResult()));
});

test("a file that fails validation is blocked before anything is planned", () => {
  const root = makeRoot({ "bad.md": "# Bad\n\n* a\n  # nope\n" });
  const out = push(root, "bad.md", null);
  assert.equal(out.plan.blocked, "validation");
  assert.equal(out.plan.create, null);
  assert.equal(out.record, null);
});

test("a conflict blocks the push and names both versions", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(0, "slack version");
  writeFile(root, "note.md", NOTE.replace("first paragraph", "local version"));
  const out = push(root, "note.md", canvas);
  assert.equal(out.plan.blocked, "conflict");
  assert.deepEqual(out.plan.conflicts, [{ local: ["local version"], remote: ["slack version"] }]);
  assert.deepEqual(out.plan.batches, []);
  assert.equal(canvas.texts()[0], "slack version");
});

test("pull takes canvas-only changes into the file and keeps its frontmatter", () => {
  const root = makeRoot({ "note.md": `---\nrelated: [other.md]\n---\n\n${NOTE}` });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(2, "last paragraph, edited in Slack");
  canvas.uiInsert(3, "added in Slack");

  const dry = pullStep(root, "note.md", canvas.readResult(), false, NOW);
  assert.equal(dry.status, "pull");
  assert.equal(dry.applied, false);
  assert.equal(readFile(root, "note.md").includes("edited in Slack"), false);

  const done = pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.equal(done.applied, true);
  const text = readFile(root, "note.md");
  assert.ok(text.startsWith("---\nrelated: [other.md]\n---\n"));
  assert.ok(text.includes("last paragraph, edited in Slack"));
  assert.ok(text.includes("added in Slack"));
  assert.equal(planPush(root, "note.md", canvas.readResult()).status, "in-sync");
});

test("a second pull with nothing new writes nothing", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  const result = pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.equal(result.status, "in-sync");
  assert.equal(result.applied, false);
});

test("pulling a rename updates the heading title", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.title = "Renamed in Slack";
  pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.ok(readFile(root, "note.md").startsWith("# Renamed in Slack\n"));
});

test("edits on both sides: push sends only local changes, then pull takes the rest", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(2, "last paragraph, from Slack");
  writeFile(root, "note.md", NOTE.replace("first paragraph", "first paragraph, local"));

  const out = push(root, "note.md", canvas);
  assert.equal(out.plan.status, "mixed");
  assert.ok(out.record);
  assert.equal(out.record.recorded, true);
  assert.equal(out.record.remaining.pull, 1);
  assert.deepEqual(canvas.texts(), ["first paragraph, local", "* a\n* b", "last paragraph, from Slack"]);

  const pulled = pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.equal(pulled.applied, true);
  assert.ok(readFile(root, "note.md").includes("from Slack"));
  assert.ok(readFile(root, "note.md").includes("first paragraph, local"));
  assert.equal(planPush(root, "note.md", canvas.readResult()).status, "in-sync");
});

test("a pull leaves unsent local edits pending instead of recording them as synced", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(2, "last paragraph, from Slack");
  writeFile(root, "note.md", NOTE.replace("first paragraph", "first paragraph, local only"));

  pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.ok(readFile(root, "note.md").includes("first paragraph, local only"));
  assert.ok(readFile(root, "note.md").includes("from Slack"));

  const plan = planPush(root, "note.md", canvas.readResult());
  assert.equal(plan.status, "push");
  assert.equal(plan.batches.length, 1);
  const out = push(root, "note.md", canvas);
  assert.equal(out.record?.recorded, true);
  assert.equal(canvas.texts()[0], "first paragraph, local only");
});

test("pull with a conflict saves the canvas's version aside and leaves the file alone", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(0, "slack version");
  const edited = NOTE.replace("first paragraph", "local version");
  writeFile(root, "note.md", edited);
  const manifestBefore = readFile(root, `${STATE_DIR}/manifest.json`);

  const dry = pullStep(root, "note.md", canvas.readResult(), false, NOW);
  assert.equal(dry.blocked, "conflict");
  assert.equal(dry.conflict_file, null);

  const result = pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.equal(result.blocked, "conflict");
  assert.equal(result.conflict_file, `${STATE_DIR}/conflicts/note.md.remote.md`);
  assert.ok(readFile(root, `${STATE_DIR}/conflicts/note.md.remote.md`).includes("slack version"));
  assert.equal(readFile(root, "note.md"), edited);
  assert.equal(readFile(root, `${STATE_DIR}/manifest.json`), manifestBefore);
});

test("pull restores a file that was deleted locally instead of deleting the canvas", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  rmSync(join(root, "note.md"));
  assert.deepEqual(scan(root).missing, [{ path: "note.md", canvas_id: "FTEST000001" }]);
  assert.throws(() => planPush(root, "note.md", canvas.readResult()), /local file is missing/);

  assert.equal(pullStep(root, "note.md", canvas.readResult(), false, NOW).status, "restore");
  assert.equal(existsSync(join(root, "note.md")), false);
  pullStep(root, "note.md", canvas.readResult(), true, NOW);
  assert.ok(readFile(root, "note.md").includes("first paragraph"));
  assert.equal(planPush(root, "note.md", canvas.readResult()).status, "in-sync");
});

test("record refuses to update the manifest when the canvas drifted after a push", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  writeFile(root, "note.md", NOTE.replace("first paragraph", "first paragraph, v2"));
  const plan = planPush(root, "note.md", canvas.readResult());
  for (const batch of plan.batches) canvas.applyUpdate(batch);
  canvas.uiEdit(0, "someone overwrote it");
  const before = readFile(root, `${STATE_DIR}/manifest.json`);

  const record = recordStep(root, "note.md", canvas.readResult(), "push", NOW);
  assert.equal(record.recorded, false);
  assert.match(record.problem ?? "", /conflict|drift/);
  assert.equal(readFile(root, `${STATE_DIR}/manifest.json`), before);
});

test("record after a push that did not happen reports drift", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  writeFile(root, "note.md", NOTE.replace("first paragraph", "first paragraph, v2"));
  const record = recordStep(root, "note.md", canvas.readResult(), "push", NOW);
  assert.equal(record.recorded, false);
  assert.match(record.problem ?? "", /drift/);
});

test("record after a pull that did not happen says so", () => {
  const root = makeRoot({ "note.md": NOTE });
  const { canvas } = push(root, "note.md", null);
  assert.ok(canvas);
  canvas.uiEdit(0, "changed in Slack");
  const record = recordStep(root, "note.md", canvas.readResult(), "pull", NOW);
  assert.equal(record.recorded, false);
  assert.match(record.problem ?? "", /after the pull/);
});

test("a file opted out with canvas_sync: false is refused", () => {
  const root = makeRoot({ "off.md": "---\ncanvas_sync: false\n---\ntext\n" });
  assert.throws(() => planPush(root, "off.md", null), /canvas_sync: false/);
});

test("a canvas tracked under another file is refused", () => {
  const root = makeRoot({ "a.md": NOTE, "b.md": NOTE });
  const { canvas } = push(root, "a.md", null);
  assert.ok(canvas);
  const read = { ...canvas.readResult(), canvas_id: "FOTHER" };
  assert.throws(() => planPush(root, "a.md", read), /different canvas/);
  assert.throws(() => pullStep(root, "a.md", read, true, NOW), /different canvas/);
});

test("a tracked file needs its current read to be planned", () => {
  const root = makeRoot({ "note.md": NOTE });
  push(root, "note.md", null);
  assert.throws(() => planPush(root, "note.md", null), /current read is required/);
});

test("paths that escape the root are rejected before any file is touched", () => {
  const root = makeRoot({});
  const canvas = new FakeCanvas("T", ["x"]);
  assert.throws(() => planPush(root, "../outside.md", null), SyncError);
  assert.throws(() => pullStep(root, "/etc/x.md", canvas.readResult(), true, NOW), SyncError);
});

// --- pending manual deletion ---

test("a canvas created from a scratch-titled file is flagged for deletion up front", () => {
  const root = makeRoot({
    "scratch.md": "# [agent-sync-scratch] try it\n\nbody\n",
    "real.md": "# Real\n\nbody\n",
  });
  const first = push(root, "scratch.md", null);
  push(root, "real.md", null);
  assert.equal(first.record?.recorded, true);

  const pending = pendingList(root).pending;
  assert.equal(pending.length, 1);
  assert.deepEqual(
    pending.map(({ reason, title }) => ({ reason, title })),
    [{ reason: "test", title: "[agent-sync-scratch] try it" }],
  );

  writeFile(root, "scratch.md", "# [agent-sync-scratch] try it\n\nbody v2\n");
  push(root, "scratch.md", first.canvas);
  assert.equal(pendingList(root).pending.length, 1);
});

test("the canvas link given at record time is kept and survives later steps", () => {
  const root = makeRoot({ "note.md": NOTE });
  const out = push(root, "note.md", null);
  assert.ok(out.canvas);
  recordStep(root, "note.md", out.canvas.readResult(), "push", NOW, "https://example.invalid/docs/T/F1");
  assert.equal(loadManifest(root).files["note.md"]?.canvas_url, "https://example.invalid/docs/T/F1");

  out.canvas.uiEdit(0, "edited in Slack");
  pullStep(root, "note.md", out.canvas.readResult(), true, NOW);
  assert.equal(loadManifest(root).files["note.md"]?.canvas_url, "https://example.invalid/docs/T/F1");
});

test("retiring a file whose local copy is gone flags its canvas and stops tracking it", () => {
  const root = makeRoot({ "note.md": NOTE });
  const out = push(root, "note.md", null);
  assert.ok(out.canvas);
  recordStep(root, "note.md", out.canvas.readResult(), "push", NOW, "https://example.invalid/F1");

  assert.throws(() => retirePath(root, "note.md", "local-file-removed", NOW), /still exists/);
  rmSync(join(root, "note.md"));
  assert.equal(scan(root).missing.length, 1);

  const item = retirePath(root, "note.md", "local-file-removed", NOW);
  assert.equal(item.canvas_url, "https://example.invalid/F1");
  assert.deepEqual(loadManifest(root).files, {});
  assert.deepEqual(scan(root).missing, []);
  const listed = pendingList(root);
  assert.equal(listed.pending[0]?.reason, "local-file-removed");
  assert.match(listed.delete_steps, /Delete canvas/);
});

test("pending entries can be added by hand and cleared once the canvas is gone", () => {
  const root = makeRoot({});
  assert.deepEqual(pendingAdd(root, { canvasId: "FX", title: "Old", reason: "superseded" }, NOW), { added: true });
  assert.deepEqual(pendingAdd(root, { canvasId: "FX", title: "Old", reason: "superseded" }, NOW), { added: false });
  assert.equal(pendingList(root).pending.length, 1);
  assert.deepEqual(pendingResolve(root, "FX"), { resolved: true });
  assert.deepEqual(pendingResolve(root, "FX"), { resolved: false });
  assert.deepEqual(pendingList(root).pending, []);
});

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

test("sync state that git tracks is reported", () => {
  const root = makeRoot({ "note.md": NOTE });
  push(root, "note.md", null);
  assert.deepEqual(trackedInGit(root), []);

  git(root, "init", "-q");
  assert.deepEqual(trackedInGit(root), [], "state dir ignores itself");

  writeFile(root, "sub/note.md.remote.md", "conflict copy\n");
  git(root, "add", "-f", `${STATE_DIR}/manifest.json`, "sub/note.md.remote.md");
  assert.deepEqual(trackedInGit(root).sort(), [`${STATE_DIR}/manifest.json`, "sub/note.md.remote.md"]);
  assert.deepEqual(scan(root).tracked_in_git.length, 2);
  assert.equal(pendingList(root).tracked_in_git.length, 2);
});

test("a root outside any git repository reports nothing tracked", () => {
  assert.deepEqual(trackedInGit(makeRoot({ "a.md": NOTE })), []);
});

test("writes never follow a symlink out of the root", () => {
  const root = makeRoot({});
  const outside = tmp();
  symlinkSync(outside, join(root, "link"));
  const canvas = new FakeCanvas("T", ["x"]);
  assert.throws(
    () => pullStep(root, "link/escape.md", canvas.readResult(), true, NOW),
    /outside the sync root/,
  );
  assert.equal(existsSync(join(outside, "escape.md")), false);
  assert.deepEqual(listMarkdown(root), []);
});
