import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  MAX_CONTENT_BYTES,
  MAX_TABLE_CELLS,
  validate,
  type IssueCode,
} from "./validate.ts";

function codes(markdown: string): IssueCode[] {
  return validate(markdown).map((issue) => issue.code);
}

const localFixtures = join(import.meta.dirname, "fixtures", "local");

for (const name of readdirSync(localFixtures)) {
  test(`${name}: fixture has no errors`, () => {
    const errors = validate(readFileSync(join(localFixtures, name), "utf8")).filter(
      (issue) => issue.severity === "error",
    );
    assert.deepEqual(errors, []);
  });
}

test("valid content reports nothing", () => {
  assert.deepEqual(
    validate("# T\n\n* a\n    * b\n\n1. x\n    1. y\n\n```\ncode\n```\n"),
    [],
  );
});

test("content over 1 MiB is an error", () => {
  assert.deepEqual(codes("a".repeat(MAX_CONTENT_BYTES + 1)), ["content-too-large"]);
  assert.deepEqual(codes("a".repeat(MAX_CONTENT_BYTES)), []);
});

test("the content limit counts UTF-8 bytes, not UTF-16 code units", () => {
  // 400,000 CJK characters are 1.2 MB in UTF-8 but only 400,000 code units.
  const cjk = "字".repeat(400_000);
  assert.ok(cjk.length < MAX_CONTENT_BYTES);
  assert.deepEqual(codes(cjk), ["content-too-large"]);
  assert.deepEqual(codes("字".repeat(300_000)), []);
});

test("a code fence closes only with the same character and a run at least as long", () => {
  const body = "* a\n  # inside the code block\n";
  // Mixed characters, a different character, and a shorter run do not close it.
  for (const notClosing of ["```~~", "~~~", "``"]) {
    assert.deepEqual(codes(`\`\`\`\n${notClosing}\n${body}`), [], notClosing);
  }
  // A longer run does close it, so the list after it is scanned again.
  assert.deepEqual(codes(`\`\`\`\n\`\`\`\`\n${body}`), ["heading-in-list-item"]);
  assert.deepEqual(codes(`~~~\n~~~\n${body}`), ["heading-in-list-item"]);
});

test("a table ends at a line that starts another block, like the normalizer", () => {
  const rows = (n: number): string =>
    Array.from({ length: n }, () => `|${"x|".repeat(10)}`).join("\n");
  const header = `|${"h|".repeat(10)}\n|${"---|".repeat(10)}\n`;
  // 29 body rows of 10 cells + the header row = 300 cells, the limit.
  assert.deepEqual(codes(`${header}${rows(29)}\n`), []);
  // The trailing "- a | b" is a list item, not a 31st row, so no overflow.
  assert.deepEqual(codes(`${header}${rows(29)}\n- a | b\n`), []);
});

test("a table over 300 cells is an error, one at the limit is not", () => {
  const table = (rows: number): string => {
    const cols = 10;
    const cell = Array.from({ length: cols }, () => "x").join("|");
    const sep = Array.from({ length: cols }, () => "---").join("|");
    return [cell, sep, ...Array.from({ length: rows - 1 }, () => cell)].join("\n");
  };
  assert.deepEqual(codes(table(MAX_TABLE_CELLS / 10)), []);
  assert.deepEqual(codes(table(MAX_TABLE_CELLS / 10 + 1)), ["table-too-large"]);
});

test("headings inside list items are errors", () => {
  assert.deepEqual(codes("* a\n  # nope\n"), ["heading-in-list-item"]);
  assert.deepEqual(codes("* # nope\n"), ["heading-in-list-item"]);
  assert.deepEqual(codes("* a\n\n# fine\n"), []);
});

test("code blocks inside list items are errors", () => {
  assert.deepEqual(codes("* a\n  ```\n  x\n  ```\n"), ["code-block-in-list-item"]);
  assert.deepEqual(codes("* ```\n"), ["code-block-in-list-item"]);
  assert.deepEqual(codes("* a\n\n```\nx\n```\n"), []);
});

test("list-looking text inside a code fence is ignored", () => {
  assert.deepEqual(codes("```\n* a\n  # b\n```\n"), []);
});

test("mixing list types when nesting is an error in both directions", () => {
  assert.deepEqual(codes("* a\n    1. b\n"), ["mixed-list-nesting"]);
  assert.deepEqual(codes("1. a\n    * b\n"), ["mixed-list-nesting"]);
  assert.deepEqual(codes("* a\n    * b\n"), []);
  assert.deepEqual(codes("* a\n\n1. b\n"), []);
});

test("tables inside layouts or columns are errors", () => {
  assert.deepEqual(
    codes("::: {.layout}\n::: {.column}\n|a|b|\n|---|---|\n|1|2|\n:::\n:::\n"),
    ["table-in-layout"],
  );
});

test("callouts inside layouts, nested callouts and layouts in callouts are errors", () => {
  assert.deepEqual(
    codes("::: {.layout}\n::: {.column}\n::: {.callout}\nx\n:::\n:::\n:::\n"),
    ["callout-in-layout"],
  );
  assert.deepEqual(
    codes("::: {.callout}\n::: {.callout}\nx\n:::\n:::\n"),
    ["nested-callout"],
  );
  assert.deepEqual(
    codes("::: {.callout}\n::: {.layout}\nx\n:::\n:::\n"),
    ["layout-in-callout"],
  );
  assert.deepEqual(codes("::: {.callout}\nx\n:::\n\n|a|b|\n|---|---|\n"), []);
});

test("h4 and deeper headings are warnings, not errors", () => {
  const issues = validate("#### deep\n");
  assert.deepEqual(
    issues.map(({ code, severity, line }) => ({ code, severity, line })),
    [{ code: "deep-heading", severity: "warning", line: 1 }],
  );
});

test("issues carry 1-based line numbers", () => {
  assert.equal(validate("ok\n\n* a\n  # bad\n")[0]?.line, 4);
});
