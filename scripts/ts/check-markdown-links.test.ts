import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  extractLinks,
  findBrokenLinks,
  makeMain,
  nodeLinkDeps,
  report,
  USAGE,
  walk,
  type LinkDeps,
  type LinkFile,
} from "./check-markdown-links.ts";
import { readTextFile } from "./lib/fs.ts";

const SCRIPT = join(import.meta.dirname, "check-markdown-links.ts");
const REPO_ROOT = join(import.meta.dirname, "..", "..");

const file = (path: string, text: string, dir = "/r"): LinkFile => ({ path, dir, text });
const existsIn =
  (...paths: string[]) =>
  (p: string): boolean =>
    paths.includes(p);

describe("extractLinks", () => {
  it("finds a relative link with its line number", () => {
    expect(extractLinks("x\n[good](./target.md)\n")).toEqual([{ line: 2, target: "./target.md" }]);
  });

  it("finds several links on one line and across lines", () => {
    expect(extractLinks("[a](a.md) and [b](b.md)\n[c](c.md)")).toEqual([
      { line: 1, target: "a.md" },
      { line: 1, target: "b.md" },
      { line: 2, target: "c.md" },
    ]);
  });

  it("ignores http, https and mailto links", () => {
    expect(
      extractLinks("[a](https://e.com/r.md) [b](http://e.com) [c](mailto:a@e.com)"),
    ).toEqual([]);
  });

  it("ignores Slack mention syntax, which is not a path", () => {
    expect(extractLinks("Ping ![](@U123ABC) in ![](#C456DEF).")).toEqual([]);
  });

  it("still reports a relative link that merely contains an at sign later in the path", () => {
    expect(extractLinks("[x](docs/@missing.md)")).toEqual([
      { line: 1, target: "docs/@missing.md" },
    ]);
  });

  it("ignores an https URL when the link text has its own parenthetical", () => {
    expect(extractLinks("[Prompt injection defenses (research)](https://e.com/research)")).toEqual(
      [],
    );
  });

  it("ignores an anchor-only link", () => {
    expect(extractLinks("[section](#some-heading)")).toEqual([]);
  });

  it("strips an anchor suffix and keeps the file part", () => {
    expect(extractLinks("[g](./target.md#section)")).toEqual([{ line: 1, target: "./target.md" }]);
  });

  it("strips inline code spans before scanning", () => {
    expect(extractLinks("see `[alt](url)` here")).toEqual([]);
  });

  it("splits on the last `](` so a parenthetical in the text is not the target", () => {
    expect(extractLinks("[foo (bar)](./real.md)")).toEqual([{ line: 1, target: "./real.md" }]);
  });

  it("uses the text after the LAST `](` when the target itself contains one", () => {
    expect(extractLinks("[a](junk](./real.md)")).toEqual([{ line: 1, target: "./real.md" }]);
  });

  it("property: results are never external, anchored or empty", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        for (const l of extractLinks(text)) {
          expect(l.target).not.toBe("");
          expect(l.target).not.toContain("#");
          expect(l.target).not.toMatch(/^(https?:\/\/|mailto:)/);
          expect(l.line).toBeGreaterThanOrEqual(1);
        }
      }),
    );
  });
});

describe("findBrokenLinks", () => {
  it("reports a broken link as path:line: broken link -> target", () => {
    expect(findBrokenLinks([file("page.md", "[bad](./missing.md)")], existsIn(), "/r")).toEqual([
      "page.md:1: broken link -> ./missing.md",
    ]);
  });

  it("resolves relative to the linking file's directory", () => {
    const f = file("docs/page.md", "[up](../target.md)", "/r/docs");
    expect(findBrokenLinks([f], existsIn("/r/docs/../target.md"), "/r")).toEqual([]);
  });

  it("falls back to repo-root-relative resolution", () => {
    const f = file("a/b/page.md", "[x](target.md)", "/r/a/b");
    expect(findBrokenLinks([f], existsIn("/r/target.md"), "/r")).toEqual([]);
  });

  it("resolves a leading-slash link against the repo root", () => {
    // "/r/" + "/target.md" collapses to a single slash on a real filesystem.
    const f = file("page.md", "[abs](/target.md)");
    const exists = (p: string): boolean => p.replace(/\/+/g, "/") === "/r/target.md";
    expect(findBrokenLinks([f], exists, "/r")).toEqual([]);
  });

  it("reports every broken link across files, in file then line order", () => {
    const files = [
      file("page.md", "[one](./a.md)\n[two](./b.md)"),
      file("docs/other.md", "[bad](./c.md)", "/r/docs"),
    ];
    expect(findBrokenLinks(files, existsIn(), "/r")).toEqual([
      "page.md:1: broken link -> ./a.md",
      "page.md:2: broken link -> ./b.md",
      "docs/other.md:1: broken link -> ./c.md",
    ]);
  });

  const target = fc.constantFrom("a.md", "b.md", "c.md", "./d.md", "../e.md");
  const lf = fc.record({
    path: fc.constantFrom("p1.md", "p2.md", "docs/p3.md", "docs/p4.md"),
    dir: fc.constantFrom("/r", "/r/docs"),
    text: fc
      .array(target.map((t) => `[l](${t})`), { maxLength: 4 })
      .map((ls) => ls.join("\n")),
  });
  const existing = fc.subarray([
    "/r/a.md",
    "/r/docs/b.md",
    "/r/c.md",
    "/r/docs/c.md",
    "/r/d.md",
    "/r/docs/d.md",
    "/r/docs/../e.md",
  ]);

  it("property: the broken set does not depend on file order", () => {
    fc.assert(
      fc.property(fc.array(lf, { maxLength: 6 }), existing, (files, paths) => {
        const exists = (p: string): boolean => paths.includes(p);
        const forward = findBrokenLinks(files, exists, "/r");
        const reversed = findBrokenLinks([...files].reverse(), exists, "/r");
        expect([...reversed].sort()).toEqual([...forward].sort());
      }),
    );
  });

  it("property: a link is never reported when its target exists next to the file", () => {
    fc.assert(
      fc.property(fc.array(lf, { maxLength: 6 }), (files) => {
        const exists = (p: string): boolean => p.startsWith("/r");
        expect(findBrokenLinks(files, exists, "/r")).toEqual([]);
      }),
    );
  });

  it("property: with nothing on disk, every checkable link is reported", () => {
    fc.assert(
      fc.property(fc.array(lf, { maxLength: 6 }), (files) => {
        const expected = files.reduce((n, f) => n + extractLinks(f.text).length, 0);
        expect(findBrokenLinks(files, existsIn(), "/r")).toHaveLength(expected);
      }),
    );
  });
});

describe("report", () => {
  it("passes with the file count", () => {
    expect(report([], 3)).toEqual({
      tag: "ok",
      value: "✓ All relative markdown links resolve (3 files scanned).\n",
    });
  });

  it("fails with EXIT_FAILURE and an indented list", () => {
    const r = report(["a.md:1: broken link -> x"], 1);
    expect(r.tag === "err" && r.error.code).toBe(1);
    expect(r.tag === "err" && r.error.message).toBe(
      "::error::Broken relative markdown links:\n  a.md:1: broken link -> x",
    );
  });
});

const tree = (): string => {
  const root = mkdtempSync(join(tmpdir(), "md-links-"));
  const tree = join(root, "tree");
  mkdirSync(tree);
  return tree;
};

describe("main over fake deps", () => {
  const fake = (over: Partial<LinkDeps> = {}): LinkDeps => ({
    exists: () => false,
    isDirectory: () => true,
    listMarkdown: () => ["/t/page.md"],
    repoRoot: () => "/t",
    ...over,
  });
  const io = { readFile: () => ({ tag: "ok", value: "[bad](./missing.md)" } as const) };

  it("defaults --path to the current directory", () => {
    const seen: string[] = [];
    const m = makeMain(fake({ listMarkdown: (d) => (seen.push(d), []) }));
    expect(m([], {}, io).tag).toBe("ok");
    expect(seen).toEqual(["."]);
  });

  it("accepts --path=value", () => {
    const seen: string[] = [];
    makeMain(fake({ listMarkdown: (d) => (seen.push(d), []) }))(["--path=x"], {}, io);
    expect(seen).toEqual(["x"]);
  });

  it("reports a broken link as EXIT_FAILURE", () => {
    const r = makeMain(fake())(["--path", "/t"], {}, io);
    expect(r.tag === "err" && r.error.code).toBe(1);
  });

  it("propagates a read failure", () => {
    const r = makeMain(fake())(["--path", "/t"], {}, { readFile: readTextFile });
    expect(r.tag === "err" && r.error.message).toContain("cannot read /t/page.md");
  });

  it("an unknown flag is a usage error", () => {
    const r = makeMain(fake())(["--nope"], {}, io);
    expect(r.tag === "err" && r.error.code).toBe(2);
  });

  it("a stray positional is a usage error", () => {
    const r = makeMain(fake())(["extra"], {}, io);
    expect(r.tag === "err" && r.error.code).toBe(2);
  });
});

describe("nodeLinkDeps", () => {
  it("walk lists markdown only, sorted, pruning .git and node_modules", () => {
    const t = tree();
    mkdirSync(join(t, "docs"));
    mkdirSync(join(t, ".git"));
    mkdirSync(join(t, "node_modules"));
    writeFileSync(join(t, "b.md"), "");
    writeFileSync(join(t, "a.md"), "");
    writeFileSync(join(t, "notes.txt"), "");
    writeFileSync(join(t, "docs", "c.md"), "");
    writeFileSync(join(t, ".git", "x.md"), "");
    writeFileSync(join(t, "node_modules", "y.md"), "");
    symlinkSync(join(t, "a.md"), join(t, "link.md"));
    expect(walk(t)).toEqual([`${t}/a.md`, `${t}/b.md`, `${t}/docs/c.md`]);
  });

  it("isDirectory distinguishes dir, file and missing", () => {
    const t = tree();
    writeFileSync(join(t, "a.md"), "");
    expect(nodeLinkDeps.isDirectory(t)).toBe(true);
    expect(nodeLinkDeps.isDirectory(join(t, "a.md"))).toBe(false);
    expect(nodeLinkDeps.isDirectory(join(t, "nope"))).toBeUndefined();
  });

  it("repoRoot is the git toplevel inside a checkout", () => {
    expect(nodeLinkDeps.repoRoot(join(REPO_ROOT, "docs"))).toMatch(/^\//);
    expect(nodeLinkDeps.repoRoot(join(REPO_ROOT, "docs"))).not.toMatch(/docs$/);
  });

  it("repoRoot falls back to the directory outside any checkout", () => {
    const t = tree();
    expect(nodeLinkDeps.repoRoot(t)).toBe(t);
  });
});

describe("end to end (spawns node)", () => {
  const exec = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  const write = (dir: string, rel: string, text: string): void => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };

  it("exit 0 when a relative link resolves", () => {
    const t = tree();
    write(t, "target.md", "target\n");
    write(t, "page.md", "[good](./target.md)\n");
    const r = exec("--path", t);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("All relative markdown links resolve (2 files scanned)");
  });

  it("exit 1 and a located message for a broken link", () => {
    const t = tree();
    write(t, "page.md", "[bad](./missing.md)\n");
    const r = exec("--path", t);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("::error::Broken relative markdown links:");
    expect(r.stderr).toContain("page.md:1: broken link -> ./missing.md");
  });

  it("reports broken links across several files", () => {
    const t = tree();
    write(t, "page.md", "[bad](./nope.md)\n");
    write(t, "docs/other.md", "[bad](./also-nope.md)\n");
    const r = exec("--path", t);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("page.md:1: broken link -> ./nope.md");
    expect(r.stderr).toContain("docs/other.md:1: broken link -> ./also-nope.md");
  });

  it("resolves up-directory, root-relative and leading-slash links", () => {
    const t = tree();
    write(t, "target.md", "x\n");
    write(t, "docs/up.md", "[up](../target.md)\n");
    write(t, "a/b/page.md", "[root-relative](target.md)\n");
    write(t, "abs.md", "[abs](/target.md)\n");
    expect(exec("--path", t).status).toBe(0);
  });

  it("a link to a real directory counts as resolved", () => {
    const t = tree();
    mkdirSync(join(t, "some-dir"));
    write(t, "page.md", "[dir](./some-dir)\n");
    expect(exec("--path", t).status).toBe(0);
  });

  it("scans a single markdown file passed via --path", () => {
    const t = tree();
    write(t, "page.md", "[bad](./missing.md)\n");
    const r = exec("--path", join(t, "page.md"));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("broken link -> ./missing.md");
  });

  it("exit 2 for a --path that does not exist", () => {
    const r = exec("--path", join(tree(), "does-not-exist"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("path not found");
  });

  it("exit 2 for a non-markdown file", () => {
    const t = tree();
    write(t, "notes.txt", "hi\n");
    const r = exec("--path", join(t, "notes.txt"));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("not a markdown file");
  });

  it("-h prints usage and exits 0", () => {
    const r = exec("-h");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(USAGE);
    expect(r.stdout).toContain("Usage: check-markdown-links");
  });

  it("an unknown flag exits 2", () => {
    expect(exec("--nope").status).toBe(2);
  });

  it("an empty directory passes with 0 files scanned", () => {
    const t = tree();
    mkdirSync(join(t, "empty"));
    const r = exec("--path", join(t, "empty"));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("0 files scanned");
  });

  // If this goes red it is either a real broken link elsewhere or a new
  // false-positive class the scanner must learn, not an assertion to loosen.
  it("the repo's own tree has no broken relative markdown links", () => {
    const r = exec("--path", REPO_ROOT);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
