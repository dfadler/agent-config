import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chunkText, main } from "./chunk-text.ts";

describe("chunkText", () => {
  it("keeps short text in one chunk", () => {
    expect(chunkText("Hello world.", 100)).toEqual(["Hello world."]);
  });

  it("returns nothing for empty or whitespace-only input", () => {
    expect(chunkText("   \n\n  ", 100)).toEqual([]);
  });

  it("rejects a non-positive limit", () => {
    expect(() => chunkText("hi", 0)).toThrow(RangeError);
  });

  it("keeps every chunk within the limit across paragraphs", () => {
    const article = Array.from({ length: 20 }, (_, i) => `Paragraph ${String(i)}. ${"word ".repeat(30)}`).join("\n\n");
    const chunks = chunkText(article, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length > 0 && c.length <= 200)).toBe(true);
  });

  it("packs paragraphs with a blank-line separator", () => {
    expect(chunkText("aa\n\nbb\n\ncc", 6)).toEqual(["aa\n\nbb", "cc"]);
  });

  it("falls back to sentence splitting for an oversized paragraph", () => {
    const chunks = chunkText("One two. Three four. Five six.", 12);
    expect(chunks).toEqual(["One two.", "Three four.", "Five six."]);
  });

  it("hard-splits a single unbroken run, losing nothing", () => {
    const chunks = chunkText("x".repeat(500), 100);
    expect(chunks).toHaveLength(5);
    expect(chunks.join("")).toBe("x".repeat(500));
  });

  it("does not cut a surrogate pair when hard-splitting", () => {
    const chunks = chunkText("😀".repeat(10), 3);
    expect(chunks.join("")).toBe("😀".repeat(10));
    expect(chunks.every((c) => !/[\ud800-\udbff]$/.test(c))).toBe(true);
  });
});

describe("main", () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), "chunk-text-"));
    const out: string[] = [];
    const err: string[] = [];
    const run = (argv: string[]) => main(argv, (s) => out.push(s), (s) => err.push(s));
    return { dir, out, err, run };
  };

  it("writes numbered chunk files and prints their paths", () => {
    const { dir, out, run } = setup();
    const input = join(dir, "in.txt");
    writeFileSync(input, "aa\n\nbb\n\ncc");
    expect(run([input, join(dir, "chunks"), "--max-chars", "6"])).toBe(0);
    expect(out).toEqual([join(dir, "chunks", "chunk_0001.txt") + "\n", join(dir, "chunks", "chunk_0002.txt") + "\n"]);
    expect(readdirSync(join(dir, "chunks")).sort()).toEqual(["chunk_0001.txt", "chunk_0002.txt"]);
    expect(readFileSync(join(dir, "chunks", "chunk_0001.txt"), "utf8")).toBe("aa\n\nbb");
  });

  it("exits 1 on empty input", () => {
    const { dir, err, run } = setup();
    const input = join(dir, "in.txt");
    writeFileSync(input, "  \n\n ");
    expect(run([input, join(dir, "c")])).toBe(1);
    expect(err.join("")).toContain("no text to chunk");
  });

  it("exits 1 on an unreadable input", () => {
    const { dir, run } = setup();
    expect(run([join(dir, "missing.txt"), join(dir, "c")])).toBe(1);
  });

  it.each([
    [["only-one"]],
    [["a", "b", "c"]],
    [["a", "b", "--max-chars", "0"]],
    [["a", "b", "--max-chars", "x"]],
    [["a", "b", "--bogus"]],
  ])("exits 2 on bad usage %j", (argv) => {
    expect(setup().run(argv)).toBe(2);
  });

  it("prints usage for --help", () => {
    const { out, run } = setup();
    expect(run(["--help"])).toBe(0);
    expect(out.join("")).toContain("Usage:");
  });
});
