import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll as after, test } from "vitest";
import { FakeCanvas } from "../test/fake-canvas.ts";
import { NAV_BLOCK_HEADER, normalizeSections } from "./normalize.ts";
import {
  loadManifest,
  planPush,
  pullStep,
  recordStep,
  retirePath,
  scan,
  type PlanResult,
} from "./sync-fs.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const made: string[] = [];

after(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "canvas-nav-test-"));
  made.push(root);
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

/** The canvases of a fake workspace, keyed by file path. */
class Workspace {
  canvases = new Map<string, FakeCanvas>();
  ids = new Map<string, string>();
  private next = 1;

  idFor(path: string): string {
    let id = this.ids.get(path);
    if (id === undefined) {
      id = `FNAV${String(this.next).padStart(4, "0")}`;
      this.next += 1;
      this.ids.set(path, id);
    }
    return id;
  }

  url(path: string): string {
    return `https://example.invalid/docs/T1/${this.idFor(path)}`;
  }

  read(path: string): unknown {
    const canvas = this.canvases.get(path);
    assert.ok(canvas, `no canvas for ${path}`);
    return canvas.readResult(this.idFor(path));
  }
}

/** Pass 1: create canvases for every new file. */
function createNew(root: string, ws: Workspace): string[] {
  const created: string[] = [];
  for (const file of scan(root).files) {
    if (file.state !== "new" || !file.sync) continue;
    const plan = planPush(root, file.path, null);
    assert.ok(plan.create, `${file.path} should create`);
    ws.canvases.set(file.path, new FakeCanvas(plan.create.title, normalizeSections(plan.create.content)));
    const record = recordStep(root, file.path, ws.read(file.path), "push", NOW, ws.url(file.path));
    assert.equal(record.recorded, true, record.problem ?? "");
    created.push(file.path);
  }
  return created;
}

/** Pass 2: bring every tracked canvas up to date, navigation blocks included. */
function updateAll(root: string, ws: Workspace): Map<string, PlanResult> {
  const plans = new Map<string, PlanResult>();
  for (const file of scan(root).files) {
    if (file.state !== "tracked" || !file.sync) continue;
    const plan = planPush(root, file.path, ws.read(file.path));
    plans.set(file.path, plan);
    if (plan.blocked !== null) continue;
    const canvas = ws.canvases.get(file.path);
    assert.ok(canvas);
    for (const batch of plan.batches) canvas.applyUpdate(batch);
    if (plan.batches.length > 0) {
      const record = recordStep(
        root,
        file.path,
        ws.read(file.path),
        "push",
        NOW,
        undefined,
        plan.nav?.record_value,
      );
      assert.equal(record.recorded, true, record.problem ?? "");
    }
  }
  return plans;
}

function sync(root: string, ws: Workspace): Map<string, PlanResult> {
  createNew(root, ws);
  return updateAll(root, ws);
}

const TREE = {
  "index.md": "# Home\n\nWelcome.\n",
  "notes.md": "# Notes\n\nSome notes.\n",
  "projects/index.md": "# Projects\n\nAll projects.\n",
  "projects/alpha.md": "---\nrelated: [beta.md]\n---\n\n# Alpha\n\nAlpha body.\n",
  "projects/beta.md": "# Beta\n\nBeta body.\n",
};

function navOf(ws: Workspace, path: string): string {
  const first = ws.canvases.get(path)?.texts()[0] ?? "";
  assert.ok(first.startsWith(`::: {.callout}\n${NAV_BLOCK_HEADER}`), `${path} should start with a nav block`);
  return first;
}

test("two passes give every canvas a navigation block that links the tree", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);

  const alpha = navOf(ws, "projects/alpha.md");
  assert.ok(alpha.includes(`[Home](${ws.url("index.md")}) > [Projects](${ws.url("projects/index.md")}) > Alpha`));
  assert.ok(alpha.includes(`* [Beta](${ws.url("projects/beta.md")})`));

  const projects = navOf(ws, "projects/index.md");
  assert.ok(projects.includes(`* [Alpha](${ws.url("projects/alpha.md")})`));
  assert.ok(projects.includes(`* [Beta](${ws.url("projects/beta.md")})`));

  const home = navOf(ws, "index.md");
  assert.ok(home.includes(`* [Projects](${ws.url("projects/index.md")})`));
  assert.ok(home.includes(`* [Notes](${ws.url("notes.md")})`));
});

test("body content is untouched by navigation blocks", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  assert.deepEqual(ws.canvases.get("notes.md")?.texts().slice(1), ["Some notes."]);
});

test("a second run changes nothing and no canvas is stale", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  const again = updateAll(root, ws);
  for (const [path, plan] of again) {
    assert.deepEqual(plan.batches, [], path);
    assert.equal(plan.nav?.action, "none", path);
  }
  assert.ok(scan(root).files.every((file) => !file.nav_stale));
});

test("pull never brings the navigation block into the local file", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  ws.canvases.get("projects/alpha.md")?.uiEdit(1, "Alpha body, edited in Slack.");

  const result = pullStep(root, "projects/alpha.md", ws.read("projects/alpha.md"), true, NOW);
  assert.equal(result.applied, true);
  const text = readFile(root, "projects/alpha.md");
  assert.ok(text.includes("edited in Slack"));
  assert.equal(text.includes("Navigation"), false);
  assert.equal(text.includes(NAV_BLOCK_HEADER), false);
  assert.equal(planPush(root, "projects/alpha.md", ws.read("projects/alpha.md")).status, "in-sync");
});

test("adding a file makes its parent's navigation stale, and the next pass fixes it", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);

  writeFile(root, "projects/gamma.md", "# Gamma\n\nGamma body.\n");
  const stale = scan(root).files.filter((file) => file.nav_stale).map((file) => file.path);
  assert.deepEqual(stale, ["projects/index.md"]);

  sync(root, ws);
  assert.ok(navOf(ws, "projects/index.md").includes(`* [Gamma](${ws.url("projects/gamma.md")})`));
  assert.ok(navOf(ws, "projects/gamma.md").includes("> Gamma"));
  assert.ok(scan(root).files.every((file) => !file.nav_stale));
});

test("renaming a file changes the navigation of the canvases that link to it", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);

  writeFile(root, "projects/beta.md", "# Beta Renamed\n\nBeta body.\n");
  assert.ok(scan(root).files.find((f) => f.path === "projects/index.md")?.nav_stale);
  sync(root, ws);

  assert.equal(ws.canvases.get("projects/beta.md")?.title, "Beta Renamed");
  assert.ok(navOf(ws, "projects/index.md").includes("[Beta Renamed]"));
  assert.ok(navOf(ws, "projects/alpha.md").includes("[Beta Renamed]"));
});

test("a retired file drops out of its parent's navigation", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);

  rmSync(join(root, "projects", "beta.md"));
  retirePath(root, "projects/beta.md", "local-file-removed", NOW);
  ws.canvases.delete("projects/beta.md");
  updateAll(root, ws);

  assert.equal(navOf(ws, "projects/index.md").includes("Beta"), false);
  assert.equal(navOf(ws, "projects/alpha.md").includes("**Related**"), false);
  assert.equal(loadManifest(root).pending_manual_deletion.length, 1);
});

test("a navigation block edited in Slack is noticed and restored", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  const canvas = ws.canvases.get("projects/alpha.md");
  assert.ok(canvas);
  canvas.uiEdit(0, `::: {.callout}\n${NAV_BLOCK_HEADER}\nsomeone typed here\n:::`);

  const plan = planPush(root, "projects/alpha.md", ws.read("projects/alpha.md"));
  assert.ok(plan.nav);
  assert.equal(plan.nav.edited_in_slack, true);
  assert.equal(plan.nav.action, "replace");

  updateAll(root, ws);
  assert.equal(navOf(ws, "projects/alpha.md").includes("someone typed here"), false);
});

test("a navigation block deleted in Slack is put back", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  ws.canvases.get("notes.md")?.uiDelete(0);

  const plan = planPush(root, "notes.md", ws.read("notes.md"));
  assert.equal(plan.nav?.action, "insert");
  updateAll(root, ws);
  navOf(ws, "notes.md");
});

test("a new block and a new first paragraph arrive together, block first", () => {
  const root = makeRoot({ "a.md": "# A\n\nfirst\n" });
  const ws = new Workspace();
  sync(root, ws);
  assert.deepEqual(ws.canvases.get("a.md")?.texts(), ["first"]);

  writeFile(root, "index.md", "# Home\n\nHome body.\n");
  writeFile(root, "a.md", "# A\n\nnew opening\n\nfirst\n");
  const plan = planPush(root, "a.md", ws.read("a.md"));
  assert.equal(plan.nav?.action, "insert");
  assert.equal(plan.batches.flat().filter((edit) => edit.edit_type === "append").length, 1);

  sync(root, ws);
  const texts = ws.canvases.get("a.md")?.texts() ?? [];
  assert.ok(texts[0]?.startsWith("::: {.callout}"));
  assert.deepEqual(texts.slice(1), ["new opening", "first"]);
});

test("related links that do not resolve are reported as warnings", () => {
  const root = makeRoot({ "a.md": "---\nrelated: [nope.md]\n---\n\n# A\n\nbody\n", "index.md": "# Home\n" });
  const ws = new Workspace();
  sync(root, ws);
  const plan = planPush(root, "a.md", ws.read("a.md"));
  assert.deepEqual(plan.nav?.warnings, ['related "nope.md" is not a synced file under the root']);
});

test("files that opt out of sync are left out of navigation", () => {
  const root = makeRoot({ ...TREE, "projects/secret.md": "---\ncanvas_sync: false\n---\n\n# Secret\n" });
  const ws = new Workspace();
  sync(root, ws);
  assert.equal(navOf(ws, "projects/index.md").includes("Secret"), false);
});

test("restoring a deleted file keeps its link and navigation record", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  const before = loadManifest(root).files["notes.md"];

  rmSync(join(root, "notes.md"));
  pullStep(root, "notes.md", ws.read("notes.md"), true, NOW);
  const after = loadManifest(root).files["notes.md"];
  assert.equal(after?.canvas_url, before?.canvas_url);
  assert.equal(after?.nav_hash, before?.nav_hash);
  assert.equal(after?.nav_remote_hash, before?.nav_remote_hash);
  assert.equal(planPush(root, "notes.md", ws.read("notes.md")).nav?.action, "none");
});

test("record without a nav hash keeps the previous one but refreshes the read-back", () => {
  const root = makeRoot(TREE);
  const ws = new Workspace();
  sync(root, ws);
  const before = loadManifest(root).files["projects/alpha.md"];
  ws.canvases.get("projects/alpha.md")?.uiEdit(0, `::: {.callout}\n${NAV_BLOCK_HEADER}\nchanged\n:::`);
  recordStep(root, "projects/alpha.md", ws.read("projects/alpha.md"), "push", NOW);
  const after = loadManifest(root).files["projects/alpha.md"];
  assert.equal(after?.nav_hash, before?.nav_hash);
  assert.notEqual(after?.nav_remote_hash, before?.nav_remote_hash);
});
