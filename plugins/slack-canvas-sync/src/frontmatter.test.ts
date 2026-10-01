import assert from "node:assert/strict";
import { test } from "node:test";
import { isSyncEnabled, parseFrontmatter, renderLocalFile } from "./frontmatter.ts";

test("parseFrontmatter reads flat fields and returns the body", () => {
  const parsed = parseFrontmatter('---\ntitle: "My Title"\nrelated: [a.md]\n---\nbody\n');
  assert.equal(parsed.fields["title"], "My Title");
  assert.equal(parsed.fields["related"], "[a.md]");
  assert.equal(parsed.body, "body\n");
  assert.equal(parsed.raw, 'title: "My Title"\nrelated: [a.md]');
});

test("text without frontmatter, or with an unterminated block, has none", () => {
  assert.equal(parseFrontmatter("just text\n").raw, null);
  assert.equal(parseFrontmatter("---\ntitle: x\nno end\n").raw, null);
});

test("indented and non-field lines are ignored", () => {
  const parsed = parseFrontmatter("---\nlist:\n  - a\n# comment\nkey: v\n---\n");
  assert.deepEqual(parsed.fields, { list: "", key: "v" });
});

test("canvas_sync: false (and its spellings) opts a file out", () => {
  for (const value of ["false", "False", "no", "off", "0"]) {
    assert.equal(isSyncEnabled(parseFrontmatter(`---\ncanvas_sync: ${value}\n---\n`)), false);
  }
  assert.equal(isSyncEnabled(parseFrontmatter("---\ncanvas_sync: true\n---\n")), true);
  assert.equal(isSyncEnabled(parseFrontmatter("no frontmatter\n")), true);
});

test("renderLocalFile puts the title in a heading when there is no frontmatter", () => {
  assert.equal(renderLocalFile(null, "T", "body\n"), "# T\n\nbody\n");
  assert.equal(renderLocalFile("old\n", null, "body\n"), "body\n");
});

test("renderLocalFile updates a frontmatter title in place and keeps other fields", () => {
  const original = "---\ntitle: Old\nrelated: [a.md]\ncanvas_sync: true\n---\n\nold body\n";
  assert.equal(
    renderLocalFile(original, "New: Title", "new body\n"),
    '---\ntitle: "New: Title"\nrelated: [a.md]\ncanvas_sync: true\n---\n\nnew body\n',
  );
  assert.ok(renderLocalFile(original, "Plain Title", "x\n").includes("title: Plain Title\n"));
});

test("renderLocalFile adds a heading when the frontmatter has no title field", () => {
  assert.equal(
    renderLocalFile("---\nrelated: [a.md]\n---\n\n# Old\n\nx\n", "New", "y\n"),
    "---\nrelated: [a.md]\n---\n\n# New\n\ny\n",
  );
});

test("renderLocalFile always ends with exactly one newline", () => {
  assert.equal(renderLocalFile(null, "T", ""), "# T\n");
  assert.equal(renderLocalFile(null, null, "x\n\n\n"), "x\n");
});
