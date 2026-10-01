import assert from "node:assert/strict";
import { test } from "node:test";
import { NAV_BLOCK_HEADER } from "./normalize.ts";
import { MAX_OPS_PER_CALL, ReadError, parseRemoteRead, toUpdateBatches } from "./slack-read.ts";

function read(mapping: Record<string, string>): unknown {
  return { canvas_id: "F1", markdown_content: "", section_id_mapping: mapping };
}

const NAV = `::: {.callout}\n${NAV_BLOCK_HEADER}\nHome\n:::`;

test("a read becomes title, sections and their section IDs", () => {
  const parsed = parseRemoteRead(read({ t: "# Title", a: "para", b: "- x\n- y" }));
  assert.equal(parsed.canvasId, "F1");
  assert.equal(parsed.content.title, "Title");
  assert.deepEqual(parsed.content.sections, ["para", "* x\n* y"]);
  assert.deepEqual(parsed.sectionIds, ["a", "b"]);
  assert.equal(parsed.titleId, "t");
  assert.equal(parsed.navId, null);
});

test("the navigation block is set aside but its ID is kept", () => {
  const parsed = parseRemoteRead(read({ t: "# T", n: NAV, a: "para" }));
  assert.deepEqual(parsed.content.sections, ["para"]);
  assert.deepEqual(parsed.sectionIds, ["a"]);
  assert.equal(parsed.navId, "n");
});

test("empty paragraphs are not tracked", () => {
  const parsed = parseRemoteRead(read({ t: "# T", e: "", a: "para" }));
  assert.deepEqual(parsed.sectionIds, ["a"]);
});

test("unusable reads are rejected with a clear reason", () => {
  const bad: [unknown, RegExp][] = [
    [null, /expected a JSON object/],
    [[], /expected a JSON object/],
    [{ section_id_mapping: {} }, /canvas_id is missing/],
    [{ canvas_id: "F1" }, /section_id_mapping is missing/],
    [read({}), /empty/],
    [read({ t: "not a title" }), /not a title line/],
    [read({ t: "# T", a: "one\n\n* two" }), /holds 2 blocks/],
    [{ canvas_id: "F1", section_id_mapping: { t: "# T", a: 5 } }, /no markdown text/],
  ];
  for (const [input, pattern] of bad) {
    assert.throws(() => parseRemoteRead(input), (error) => {
      assert.ok(error instanceof ReadError);
      assert.match(error.message, pattern);
      return true;
    });
  }
});

test("ops map onto the section IDs of the read they were planned against", () => {
  const parsed = parseRemoteRead(read({ t: "# T", a: "one", b: "two", c: "three" }));
  const [batch] = toUpdateBatches(
    [
      { type: "rename", title: "New" },
      { type: "replace", remoteIndex: 0, text: "ONE" },
      { type: "delete", remoteIndex: 1 },
      { type: "insert_after", afterIndex: 2, text: "four" },
      { type: "insert_after", afterIndex: -1, text: "zero" },
    ],
    parsed,
  );
  assert.deepEqual(batch, [
    { edit_type: "replace", section_id: "t", content: "# New" },
    { edit_type: "replace", section_id: "a", content: "ONE" },
    { edit_type: "delete", section_id: "b" },
    { edit_type: "append", section_id: "c", content: "four" },
    { edit_type: "append", section_id: "t", content: "zero" },
  ]);
});

test("inserting at the top goes after the navigation block when there is one", () => {
  const parsed = parseRemoteRead(read({ t: "# T", n: NAV, a: "one" }));
  const [batch] = toUpdateBatches([{ type: "insert_after", afterIndex: -1, text: "x" }], parsed);
  assert.deepEqual(batch, [{ edit_type: "append", section_id: "n", content: "x" }]);
});

test("an op pointing past the canvas is an error, not a guess", () => {
  const parsed = parseRemoteRead(read({ t: "# T", a: "one" }));
  assert.throws(
    () => toUpdateBatches([{ type: "delete", remoteIndex: 5 }], parsed),
    /no section at index 5/,
  );
});

test("large plans are split into batches the connector accepts", () => {
  const parsed = parseRemoteRead(read({ t: "# T", a: "one" }));
  const ops = Array.from({ length: MAX_OPS_PER_CALL * 2 + 1 }, (_, i) => ({
    type: "insert_after" as const,
    afterIndex: 0,
    text: String(i),
  }));
  const batches = toUpdateBatches(ops, parsed);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 1]);
  assert.deepEqual(toUpdateBatches([], parsed), []);
});
