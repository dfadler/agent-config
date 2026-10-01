import assert from "node:assert/strict";
import { test } from "node:test";
import { hashText } from "../../../scripts/ts/hash.ts";
import { emptyManifest, snapshotFile } from "./manifest.ts";
import {
  buildNavBlocks,
  canvasUrl,
  parentOf,
  parseRelated,
  planNav,
  resolveRelated,
  type NavFile,
} from "./nav.ts";
import { NAV_BLOCK_HEADER } from "./normalize.ts";

function file(path: string, title: string, extra: Partial<NavFile> = {}): NavFile {
  return { path, title, url: `https://example.invalid/${path}`, related: [], ...extra };
}

test("parseRelated accepts a list, a bare list, or one path", () => {
  assert.deepEqual(parseRelated("[a.md, \"b/c.md\", 'd.md']"), ["a.md", "b/c.md", "d.md"]);
  assert.deepEqual(parseRelated("a.md, b.md"), ["a.md", "b.md"]);
  assert.deepEqual(parseRelated("a.md"), ["a.md"]);
  assert.deepEqual(parseRelated(""), []);
  assert.deepEqual(parseRelated(undefined), []);
});

test("resolveRelated is relative to the file's directory and stays in the root", () => {
  assert.equal(resolveRelated("a/b.md", "c.md"), "a/c.md");
  assert.equal(resolveRelated("a/b.md", "./c.md"), "a/c.md");
  assert.equal(resolveRelated("a/b.md", "../c.md"), "c.md");
  assert.equal(resolveRelated("a/b.md", "../../c.md"), null);
  assert.equal(resolveRelated("a/b.md", "notes.txt"), null);
});

test("parentOf finds the nearest enclosing index file", () => {
  const known = new Set(["index.md", "p/index.md", "p/a.md", "p/q/b.md", "p/q/index.md", "r/c.md"]);
  assert.equal(parentOf("p/a.md", known), "p/index.md");
  assert.equal(parentOf("p/q/b.md", known), "p/q/index.md");
  assert.equal(parentOf("p/q/index.md", known), "p/index.md");
  assert.equal(parentOf("p/index.md", known), "index.md");
  assert.equal(parentOf("r/c.md", known), "index.md");
  assert.equal(parentOf("index.md", known), null);
  assert.equal(parentOf("lone.md", new Set(["lone.md"])), null);
});

test("a lone note gets no navigation block", () => {
  const { blocks } = buildNavBlocks([file("note.md", "Note")]);
  assert.equal(blocks.get("note.md"), "");
});

test("a child shows a breadcrumb; its parent lists it as a child", () => {
  const { blocks } = buildNavBlocks([
    file("index.md", "Home"),
    file("projects/index.md", "Projects"),
    file("projects/alpha.md", "Alpha"),
  ]);
  const alpha = blocks.get("projects/alpha.md") ?? "";
  assert.ok(alpha.startsWith(`::: {.callout}\n${NAV_BLOCK_HEADER}`));
  assert.ok(
    alpha.includes(
      "[Home](https://example.invalid/index.md) > [Projects](https://example.invalid/projects/index.md) > Alpha",
    ),
  );
  assert.equal(alpha.includes("**Children**"), false);

  const projects = blocks.get("projects/index.md") ?? "";
  assert.ok(projects.includes("**Children**"));
  assert.ok(projects.includes("* [Alpha](https://example.invalid/projects/alpha.md)"));
  assert.ok(blocks.get("index.md")?.includes("* [Projects](https://example.invalid/projects/index.md)"));
});

test("the breadcrumb is its own paragraph, since Slack folds a line break into a space", () => {
  const { blocks } = buildNavBlocks([file("index.md", "Home"), file("a.md", "A")]);
  assert.ok(blocks.get("a.md")?.includes(`${NAV_BLOCK_HEADER}\n\n[Home]`));
});

test("links are whole-canvas links, never section anchors", () => {
  const { blocks } = buildNavBlocks([file("index.md", "Home"), file("a.md", "A")]);
  for (const block of blocks.values()) assert.equal(block.includes("focus_section_id"), false);
});

test("a canvas that does not exist yet is named but not linked", () => {
  const { blocks } = buildNavBlocks([file("index.md", "Home"), file("a.md", "A", { url: null })]);
  assert.ok(blocks.get("index.md")?.includes("* A\n"));
  assert.equal(blocks.get("index.md")?.includes("[A]("), false);
});

test("related files are listed in order, skipping itself and duplicates", () => {
  const { blocks, warnings } = buildNavBlocks([
    file("a.md", "A", { related: ["c.md", "b.md", "c.md", "a.md"] }),
    file("b.md", "B"),
    file("c.md", "C"),
  ]);
  const a = blocks.get("a.md") ?? "";
  assert.ok(a.includes("**Related**"));
  assert.ok(a.indexOf("[C]") < a.indexOf("[B]"));
  assert.equal(a.match(/\[C\]/g)?.length, 1);
  assert.equal(warnings.has("a.md"), false);
});

test("related paths that do not resolve produce a warning, not a broken link", () => {
  const { blocks, warnings } = buildNavBlocks([
    file("a.md", "A", { related: ["missing.md", "../outside.md"] }),
  ]);
  assert.equal(blocks.get("a.md"), "");
  assert.equal(warnings.get("a.md")?.length, 2);
});

test("brackets in titles are escaped so links stay intact", () => {
  const { blocks } = buildNavBlocks([
    file("index.md", "Home"),
    file("a.md", "[agent-sync-scratch] try"),
  ]);
  assert.ok(blocks.get("index.md")?.includes("[\\[agent-sync-scratch\\] try](https://example.invalid/a.md)"));
});

test("children are ordered by path so the block is stable", () => {
  const a = buildNavBlocks([file("index.md", "H"), file("b.md", "B"), file("a.md", "A")]);
  const b = buildNavBlocks([file("index.md", "H"), file("a.md", "A"), file("b.md", "B")]);
  assert.equal(a.blocks.get("index.md"), b.blocks.get("index.md"));
});

test("canvasUrl uses the recorded link, or borrows the workspace prefix", () => {
  const manifest = emptyManifest();
  const a = {
    ...snapshotFile({ canvasId: "FAAA", title: null, sections: [], now: "t" }),
    canvas_url: "https://example.invalid/docs/T1/FAAA",
  };
  const b = snapshotFile({ canvasId: "FBBB", title: null, sections: [], now: "t" });
  manifest.files["a.md"] = a;
  manifest.files["b.md"] = b;
  assert.equal(canvasUrl(manifest, a), "https://example.invalid/docs/T1/FAAA");
  assert.equal(canvasUrl(manifest, b), "https://example.invalid/docs/T1/FBBB");
  assert.equal(canvasUrl(emptyManifest(), b), null);
});

// --- planNav ---

const DESIRED = `::: {.callout}\n${NAV_BLOCK_HEADER}\nHome\n:::`;

test("no block wanted and none present needs nothing", () => {
  const plan = planNav({ desired: "", base: null, navId: null, navText: null, titleId: "t" });
  assert.equal(plan.action, "none");
  assert.equal(plan.edit, null);
  assert.equal(plan.recordValue, "none");
});

test("a block wanted but absent is inserted after the title", () => {
  const plan = planNav({ desired: DESIRED, base: null, navId: null, navText: null, titleId: "t" });
  assert.equal(plan.action, "insert");
  assert.deepEqual(plan.edit, { edit_type: "append", section_id: "t", content: DESIRED });
  assert.equal(plan.recordValue, hashText(DESIRED));
});

test("a block no longer wanted is deleted", () => {
  const plan = planNav({ desired: "", base: null, navId: "n", navText: DESIRED, titleId: "t" });
  assert.equal(plan.action, "delete");
  assert.deepEqual(plan.edit, { edit_type: "delete", section_id: "n" });
});

test("an up-to-date block is left alone, whatever formatting Slack stored", () => {
  const base = { nav_hash: hashText(DESIRED), nav_remote_hash: hashText("how Slack stored it") };
  const plan = planNav({ desired: DESIRED, base, navId: "n", navText: "how Slack stored it", titleId: "t" });
  assert.equal(plan.action, "none");
  assert.equal(plan.editedInSlack, false);
});

test("a changed block is replaced", () => {
  const base = { nav_hash: hashText("older"), nav_remote_hash: hashText("older") };
  const plan = planNav({ desired: DESIRED, base, navId: "n", navText: "older", titleId: "t" });
  assert.equal(plan.action, "replace");
  assert.deepEqual(plan.edit, { edit_type: "replace", section_id: "n", content: DESIRED });
});

test("a block edited in Slack is flagged and rewritten", () => {
  const base = { nav_hash: hashText(DESIRED), nav_remote_hash: hashText(DESIRED) };
  const plan = planNav({ desired: DESIRED, base, navId: "n", navText: "someone changed this", titleId: "t" });
  assert.equal(plan.editedInSlack, true);
  assert.equal(plan.action, "replace");
});

test("a block with no recorded read-back is rewritten once to establish one", () => {
  const plan = planNav({
    desired: DESIRED,
    base: { nav_hash: hashText(DESIRED) },
    navId: "n",
    navText: DESIRED,
    titleId: "t",
  });
  assert.equal(plan.action, "replace");
  assert.equal(plan.editedInSlack, false);
});
