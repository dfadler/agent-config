import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeMain, nodeListFiles } from "./check-vitest-v3-names.ts";
import { readTextFile } from "./lib/fs.ts";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(import.meta.dirname, "check-vitest-v3-names.ts");

const exec = (args: readonly string[], cwd = REPO_ROOT) => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};

describe("end to end against a fixture tree", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "v3-names-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes on a tree with only v4 names and annotated v3 mentions", () => {
    writeFileSync(join(dir, "a.md"), "Use maxWorkers.\npoolOptions was removed in v4.\n");
    const r = exec([dir]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("No unannotated");
  });

  it("fails with exit 1 naming file and line of an unannotated v3 name, in a nested dir", () => {
    mkdirSync(join(dir, "x", "y"), { recursive: true });
    writeFileSync(join(dir, "x", "y", "b.md"), "fine\n--poolOptions.threads.maxThreads=2\n");
    const r = exec([dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`${join(dir, "x", "y", "b.md")}:2`);
  });

  it("reports every offending file", () => {
    writeFileSync(join(dir, "one.md"), "VITEST_MAX_THREADS=2\n");
    writeFileSync(join(dir, "two.ts"), "// singleFork: true\n");
    const r = exec([dir]);
    expect(r.stderr).toContain("one.md");
    expect(r.stderr).toContain("two.ts");
  });

  it("skips node_modules, worktrees and evals directories and non-text files", () => {
    for (const d of ["node_modules", "worktrees", "evals"]) {
      mkdirSync(join(dir, d));
      writeFileSync(join(dir, d, "c.md"), "maxForks\n");
    }
    writeFileSync(join(dir, "image.png"), "maxForks\n");
    expect(exec([dir]).status).toBe(0);
  });

  it("ignores a root that does not exist", () => {
    expect(exec([join(dir, "nope")]).status).toBe(0);
  });
});

describe("nodeListFiles", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "v3-list-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists text files recursively and sorted, and skips vendored directories", () => {
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "node_modules"));
    writeFileSync(join(dir, "b.md"), "");
    writeFileSync(join(dir, "a.yaml"), "");
    writeFileSync(join(dir, "sub", "c.ts"), "");
    writeFileSync(join(dir, "pic.png"), "");
    writeFileSync(join(dir, "node_modules", "d.md"), "");
    expect(nodeListFiles([dir])).toEqual([
      join(dir, "a.yaml"),
      join(dir, "b.md"),
      join(dir, "sub", "c.ts"),
    ]);
  });

  it("accepts a file root and skips a missing one", () => {
    writeFileSync(join(dir, "x.md"), "");
    expect(nodeListFiles([join(dir, "x.md"), join(dir, "missing")])).toEqual([join(dir, "x.md")]);
  });
});

describe("makeMain", () => {
  it("scans plugins, docs and .claude by default", () => {
    const seen: (readonly string[])[] = [];
    makeMain((roots) => {
      seen.push(roots);
      return [];
    })([], {}, { readFile: readTextFile });
    expect(seen).toEqual([["plugins", "docs", ".claude"]]);
  });

  it("prints usage for --help", () => {
    const r = makeMain(nodeListFiles)(["--help"], {}, { readFile: readTextFile });
    expect(r.tag === "ok" && r.value).toContain("Usage: check-vitest-v3-names.ts");
  });
});

describe("this repo", () => {
  it("has no unannotated Vitest 3 names under plugins, docs or .claude", () => {
    const r = exec([]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});
