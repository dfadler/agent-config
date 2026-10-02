import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";
import {
  NAV_BLOCK_HEADER,
  normalizeBody,
  normalizeLocal,
  normalizeRemote,
  normalizeSections,
  renderSections,
  stripNavBlock,
} from "./normalize.ts";

const fixtures = join(import.meta.dirname, "..", "test", "fixtures");

function fixture(side: "local" | "remote", name: string): string {
  return readFileSync(join(fixtures, side, name), "utf8");
}

const fixtureNames = readdirSync(join(fixtures, "local"));

test("fixture corpus is non-empty and paired", () => {
  assert.ok(fixtureNames.length >= 2);
  assert.deepEqual(readdirSync(join(fixtures, "remote")), fixtureNames);
});

for (const name of fixtureNames) {
  test(`${name}: local source and recorded Slack read normalize identically`, () => {
    const local = normalizeLocal(fixture("local", name));
    const remote = normalizeRemote(fixture("remote", name));
    assert.equal(local.body, remote.body);
    assert.equal(local.title, remote.title);
    assert.notEqual(local.body, "");
  });

  test(`${name}: normalization is idempotent`, () => {
    for (const side of ["local", "remote"] as const) {
      const once = normalizeBody(fixture(side, name));
      assert.equal(normalizeBody(once), once);
    }
  });
}

test("bullets of any marker become *, nested indent becomes 4 spaces", () => {
  assert.equal(
    normalizeBody("- a\n+ b\n  - c\n    * d\n"),
    "* a\n* b\n    * c\n        * d\n",
  );
  assert.equal(normalizeBody("* a\n\t* b\n"), "* a\n    * b\n");
});

test("ordered lists are renumbered and nested counters restart", () => {
  assert.equal(
    normalizeBody("3. a\n7. b\n   1. x\n   1. y\n9. c\n"),
    "1. a\n2. b\n    1. x\n    2. y\n3. c\n",
  );
});

test("checklists use * [ ] / * [x] and capital X is lowered", () => {
  assert.equal(normalizeBody("- [ ] a\n- [X] b\n"), "* [ ] a\n* [x] b\n");
});

test("a different top-level list type starts a separate block", () => {
  assert.equal(
    normalizeBody("- a\n1. b\n- [ ] c\n"),
    "* a\n\n1. b\n\n* [ ] c\n",
  );
});

test("headings get surrounding blank lines and are clamped to h3", () => {
  assert.equal(
    normalizeBody("text\n# One\ntext\n##### Deep ##\n"),
    "text\n\n# One\n\ntext\n\n### Deep\n",
  );
});

test("thematic breaks collapse to ---", () => {
  assert.equal(normalizeBody("a\n\n***\n\n___\n\n- - -\n"), "a\n\n---\n\n---\n\n---\n");
});

test("table cells are compacted and the separator is canonical", () => {
  assert.equal(
    normalizeBody("| A | B |\n|:--|--:|\n| 1 | 2 |\n"),
    "|A|B|\n|  ---  |  ---  |\n|1|2|\n",
  );
  assert.equal(
    normalizeBody("A | B\n---|---\n1 | 2\n"),
    "|A|B|\n|  ---  |  ---  |\n|1|2|\n",
  );
});

test("a table ends at a line that starts another block, even one containing a pipe", () => {
  const table = "|a|b|\n|---|---|\n|1|2|\n";
  assert.equal(
    normalizeBody(`${table}- x | y\n`),
    "|a|b|\n|  ---  |  ---  |\n|1|2|\n\n* x | y\n",
  );
  assert.equal(
    normalizeBody(`${table}# Head | v\n`),
    "|a|b|\n|  ---  |  ---  |\n|1|2|\n\n# Head | v\n",
  );
  assert.equal(
    normalizeBody(`${table}> quote | v\n`),
    "|a|b|\n|  ---  |  ---  |\n|1|2|\n\n> quote | v\n",
  );
  // The header and separator always belong to the table.
  assert.equal(normalizeBody("|a|b|\n|---|---|\n"), "|a|b|\n|  ---  |  ---  |\n");
});

test("a code fence closes only with the same character and a run at least as long", () => {
  assert.equal(
    normalizeBody("```\n```~~\n~~~\n``\nstill code\n```\nafter\n"),
    "```\n```~~\n~~~\n``\nstill code\n```\n\nafter\n",
  );
  assert.equal(normalizeBody("~~~\n```\n~~~~\nafter\n"), "~~~\n```\n~~~~\n\nafter\n");
});

test("an escaped pipe does not split a table cell", () => {
  assert.equal(
    normalizeBody("| a\\|b | c |\n|---|---|\n| 1 | 2 |\n"),
    "|a\\|b|c|\n|  ---  |  ---  |\n|1|2|\n",
  );
});

test("runs of blank lines collapse and trailing whitespace is trimmed", () => {
  assert.equal(normalizeBody("a  \n\n\n\nb\t\n"), "a\n\nb\n");
});

test("CRLF input matches LF input", () => {
  assert.equal(normalizeBody("a\r\n\r\n- b\r\n"), normalizeBody("a\n\n- b\n"));
});

test("fenced code is preserved verbatim, including blank lines and markup", () => {
  const code = "```ts\n- not a bullet\n\n\n#### not a heading\n   indented\n```";
  assert.equal(normalizeBody(`before\n${code}\nafter`), `before\n\n${code}\n\nafter\n`);
});

test("an unclosed fence runs to the end of input", () => {
  assert.equal(normalizeBody("```\nabc\n\nlast"), "```\nabc\n\nlast\n");
});

test("callouts keep their content tight against the delimiters", () => {
  assert.equal(
    normalizeBody("::: {.callout}\n\nHello\n\n:::\n"),
    "::: {.callout}\nHello\n:::\n",
  );
});

test("layouts with columns normalize their inner content", () => {
  assert.equal(
    normalizeBody("::: {.layout}\n::: {.column}\n- a\n:::\n::: {.column}\n- b\n:::\n:::\n"),
    "::: {.layout}\n::: {.column}\n* a\n:::\n\n::: {.column}\n* b\n:::\n:::\n",
  );
});

test("block quotes get a single space after >", () => {
  assert.equal(normalizeBody(">a\n>  b\n>\n> c\n"), "> a\n> b\n>\n> c\n");
});

test("empty and whitespace-only input normalize to the empty string", () => {
  assert.equal(normalizeBody(""), "");
  assert.equal(normalizeBody("  \n\n\t\n"), "");
});

test("a paragraph followed directly by a list keeps them as separate blocks", () => {
  assert.equal(normalizeBody("intro\n- a\n- b\n"), "intro\n\n* a\n* b\n");
});

test("a paragraph followed directly by a quote or rule splits", () => {
  assert.equal(normalizeBody("a\n> q\n"), "a\n\n> q\n");
  assert.equal(normalizeBody("a\n---\n"), "a\n\n---\n");
});

const NAV = `::: {.callout}\n${NAV_BLOCK_HEADER}\nHome > Test\n:::`;

test("the generated navigation block is stripped from both sides", () => {
  const local = normalizeLocal(`# Title\n\n${NAV}\n\n# Body\n`);
  const remote = normalizeRemote(`# Title\n\n${NAV}\n\n# Body\n`);
  assert.equal(local.body, "# Body\n");
  assert.equal(remote.body, "# Body\n");
});

test("a callout that is not the navigation block is kept", () => {
  const body = normalizeBody("::: {.callout}\nHeads up\n:::\n\ntext\n");
  assert.equal(stripNavBlock(body), body);
});

test("a navigation block that is not first is kept", () => {
  const body = normalizeBody(`intro\n\n${NAV}\n`);
  assert.equal(stripNavBlock(body), body);
});

test("a navigation block with nothing after it strips to empty", () => {
  assert.equal(normalizeLocal(`# T\n\n${NAV}\n`).body, "");
});

test("frontmatter is dropped and its title wins over a leading h1", () => {
  const result = normalizeLocal('---\ntitle: "From FM"\ntags: [a]\n---\n# Heading\n\ntext\n');
  assert.equal(result.title, "From FM");
  assert.equal(result.body, "# Heading\n\ntext\n");
});

test("without a frontmatter title the leading h1 is the title and leaves the body", () => {
  const result = normalizeLocal("---\ntags: [a]\n---\n\n# Heading\n\ntext\n");
  assert.equal(result.title, "Heading");
  assert.equal(result.body, "text\n");
});

test("input with no leading h1 has a null title and keeps all content", () => {
  const result = normalizeLocal("just text\n");
  assert.equal(result.title, null);
  assert.equal(result.body, "just text\n");
  assert.equal(normalizeRemote("just text\n").title, null);
});

test("unterminated frontmatter is treated as content", () => {
  assert.equal(normalizeLocal("---\ntitle: x\nno end\n").title, null);
});

test("hand-edited local text and a remote read of it hash-compare equal", () => {
  const local = normalizeLocal(
    "# T\n\n* a\n  * b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n",
  );
  const remote = normalizeRemote(
    "# T\n\n* a\n    * b\n\n|x|y|\n|  ---  |  ---  |\n|1|2|\n\n",
  );
  assert.equal(local.body, remote.body);
});

test("mentions read back in message syntax match the canvas syntax they were written in", () => {
  const written = normalizeBody("Ping ![](@U123ABC) in ![](#C456DEF) now.\n");
  assert.equal(normalizeBody("Ping <@U123ABC> in <#C456DEF> now.\n"), written);
  assert.equal(normalizeBody("Ping <@U123ABC|alice> in <#C456DEF|general> now.\n"), written);
  assert.equal(written, "Ping ![](@U123ABC) in ![](#C456DEF) now.\n");
});

test("mentions are canonicalized inside lists, tables, and callouts, but not in code fences", () => {
  assert.equal(normalizeBody("* hi <@UAAA111>\n"), "* hi ![](@UAAA111)\n");
  assert.equal(normalizeBody("|a|\n|---|\n|<@UAAA111>|\n"), "|a|\n|  ---  |\n|![](@UAAA111)|\n");
  assert.equal(normalizeBody("::: {.callout}\n<@UAAA111>\n:::\n"), "::: {.callout}\n![](@UAAA111)\n:::\n");
  const code = "```\n<@UAAA111>\n```";
  assert.equal(normalizeBody(`${code}\n\n<@UAAA111>\n`), `${code}\n\n![](@UAAA111)\n`);
});

test("text that only looks like a mention is left alone", () => {
  assert.equal(normalizeBody("a <b> and <@not-an-id> c\n"), "a <b> and <@not-an-id> c\n");
});

test("sections are the top-level blocks, and re-rendering them gives the body", () => {
  const result = normalizeLocal("# T\n\n- a\n- b\n\n```\nx\n\ny\n```\n\ntext\n");
  assert.deepEqual(result.sections, ["* a\n* b", "```\nx\n\ny\n```", "text"]);
  assert.equal(renderSections(result.sections), result.body);
  assert.equal(renderSections([]), "");
  assert.deepEqual(normalizeSections(""), []);
});
