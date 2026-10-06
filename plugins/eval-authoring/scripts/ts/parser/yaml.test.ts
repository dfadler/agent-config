import { describe, expect, it } from "vitest";
import { parseYaml, splitFrontmatter, type YNode } from "./yaml.ts";

/** Plain JS view of a node, to compare shapes without positions. */
const toJs = (n: YNode | undefined): unknown => {
  if (n === undefined) return undefined;
  if (n.kind === "scalar") return n.value;
  if (n.kind === "seq") return n.items.map(toJs);
  return Object.fromEntries(n.entries.map((e) => [e.key, toJs(e.value)]));
};

const read = (text: string): unknown => {
  const r = parseYaml(text);
  if (!r.ok) throw new Error(`${r.message} @${String(r.line)}`);
  return toJs(r.value);
};

describe("parseYaml", () => {
  it("reads maps, nested maps, sequences and scalar types", () => {
    expect(
      read(
        [
          "a: 1",
          "b: true",
          "c: ~",
          "d: hello world # comment",
          "e: '1.1'",
          'f: "x\\ty"',
          "n:",
          "  m: 2.5",
          "list:",
          "  - one",
          "  - two",
        ].join("\n"),
      ),
    ).toEqual({
      a: 1,
      b: true,
      c: null,
      d: "hello world",
      e: "1.1",
      f: "x\ty",
      n: { m: 2.5 },
      list: ["one", "two"],
    });
  });

  it("reads a sequence at the parent key's indent and maps in items", () => {
    expect(
      read(
        ["graders:", "- name: a", "  type: regex", "- name: b", "  type: llm"].join(
          "\n",
        ),
      ),
    ).toEqual({
      graders: [
        { name: "a", type: "regex" },
        { name: "b", type: "llm" },
      ],
    });
  });

  it("reads flow collections and quoted keys", () => {
    expect(read("t: [a, 'b c', 3]\nm: { x: 1, y: [2] }\n\"q k\": v")).toEqual({
      t: ["a", "b c", 3],
      m: { x: 1, y: [2] },
      "q k": "v",
    });
  });

  it("reads literal and folded block scalars with chomping", () => {
    expect(
      read("a: |\n  l1\n  l2\n\nb: >\n  f1\n  f2\n\n  f3\nc: |-\n  x\n"),
    ).toEqual({ a: "l1\nl2\n", b: "f1 f2\nf3\n", c: "x" });
  });

  it("keeps # inside block scalars and quotes", () => {
    expect(read("a: |\n  # not a comment\nb: 'x # y'")).toEqual({
      a: "# not a comment\n",
      b: "x # y",
    });
  });

  it("returns undefined for empty input and skips a leading ---", () => {
    expect(read("# only a comment\n")).toBeUndefined();
    expect(read("---\na: 1")).toEqual({ a: 1 });
  });

  it("records line and column of keys and values", () => {
    const r = parseYaml("a: 1\nb:\n  c: x", 10);
    expect(r.ok && r.value?.kind === "map" && r.value.entries[1]?.keyLine).toBe(
      11,
    );
    const v =
      r.ok && r.value?.kind === "map" ? r.value.entries[0]?.value : undefined;
    expect(v?.kind === "scalar" && [v.line, v.column]).toEqual([10, 4]);
  });

  it("handles a doubled quote inside a single-quoted scalar", () => {
    expect(read("a: 'it''s # x' # real comment\nb: 'x'")).toEqual({
      a: "it's # x",
      b: "x",
    });
    expect(read("a: ['it''s', 'b']")).toEqual({ a: ["it's", "b"] });
  });

  it("does not overflow the stack on very long lines", () => {
    const long = "x".repeat(50_000);
    expect(read(`plain: ${long}\ndq: "${long}"\nsq: '${long}'\ncm: ${long} # c`)).toEqual({
      plain: long,
      dq: long,
      sq: long,
      cm: long,
    });
    expect(read(`a: [${" ".repeat(50_000)}1${" ".repeat(50_000)}]`)).toEqual({
      a: [1],
    });
    expect(parseYaml(`a: "${long}`).ok).toBe(false);
    expect(parseYaml(`a: '${long}`).ok).toBe(false);
  });

  it("returns an error, never throws, for huge or deeply nested input", () => {
    const items = Array.from({ length: 200_000 }, () => "1").join(",");
    expect(() => parseYaml(`a: [${items}]`)).not.toThrow();
    expect(() => parseYaml(`a: ${"[".repeat(200_000)}`)).not.toThrow();
    const many = Array.from({ length: 200_000 }, (_, i) => `k${String(i)}: 1`);
    expect(() => parseYaml(many.join("\n"))).not.toThrow();
    expect(parseYaml(`a: ${"[".repeat(200_000)}`).ok).toBe(false);
  });

  it.each([
    ["tab indent", "a:\n\tb: 1"],
    ["duplicate key", "a: 1\na: 2"],
    ["anchor", "a: &x 1"],
    ["anchor inside a flow sequence", "a: [&x 1]"],
    ["alias inside a flow mapping", "a: { k: *x }"],
    ["tag inside a flow sequence", "a: [!!str 1]"],
    ["duplicate key in a flow mapping", "a: { k: 1, k: 2 }"],
    ["duplicate key in a nested flow mapping", "a: [{ k: 1, k: 2 }]"],
    ["unterminated quote", 'a: "x'],
    ["unterminated flow", "a: [1, 2"],
    ["multi-line plain scalar", "a: x\n  y"],
    ["bad indentation", "a: 1\n  b: 2"],
    ["explicit indent indicator", "a: |2\n   x"],
    ["bad escape", 'a: "\\q"'],
    ["stray text after flow", "a: [1] x"],
    ["not a key", "a: 1\nplain"],
  ])("reports an error for %s", (_name, text) => {
    expect(parseYaml(text).ok).toBe(false);
  });
});

describe("splitFrontmatter", () => {
  it("splits fenced frontmatter and tracks lines", () => {
    expect(splitFrontmatter("---\nruns: 1\n---\nbody\nmore")).toEqual({
      kind: "found",
      yaml: "runs: 1",
      yamlLine: 2,
      body: "body\nmore",
      bodyLine: 4,
    });
  });
  it("treats a file with no fence as all body", () => {
    expect(splitFrontmatter("just text")).toEqual({
      kind: "none",
      body: "just text",
      bodyLine: 1,
    });
  });
  it("flags an unterminated fence", () => {
    expect(splitFrontmatter("---\nruns: 1\n").kind).toBe("unterminated");
  });
});
