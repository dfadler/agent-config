import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRun } from "./proc.ts";
import { main, type Ctx } from "./verify-worktree-symlinks.ts";
import { makeSandbox, put, type Sandbox } from "./test-helpers.ts";

let sb: Sandbox;
let wt: string;
beforeEach(() => {
  sb = makeSandbox();
  // The main checkout has a node_modules to point at.
  mkdirSync(join(sb.repo, "node_modules"));
  wt = sb.addWorktree("w");
});
afterEach(() => {
  sb.cleanup();
});

const settings = (v: unknown): void => {
  put(join(wt, ".claude", "settings.json"), JSON.stringify({ worktree: { symlinkDirectories: v } }));
};

const go = (args: string[], cwd = wt) => {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    cwd,
    run: makeRun(sb.env),
    out: (t) => out.push(t),
    err: (l) => err.push(l),
  };
  return { code: main(args, ctx), out: out.join(""), err: err.join("\n") };
};

const link = (target: string): void => {
  symlinkSync(target, join(wt, "node_modules"));
};
const mainNm = (): string => join(sb.repo, "node_modules");

describe("verify-worktree-symlinks", () => {
  it("passes a symlink pointing at the main checkout", () => {
    settings(["node_modules"]);
    link(mainNm());
    expect(go([])).toEqual({ code: 0, out: "", err: "" });
  });

  it("catches a symlink to a different directory; --fix relinks it", () => {
    settings(["node_modules"]);
    const other = join(sb.root, "other-nm");
    mkdirSync(other);
    link(other);
    const bad = go([]);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/not the main checkout/);
    const fixed = go(["--fix"]);
    expect(fixed.code).toBe(0);
    expect(fixed.err).toMatch(/relinked node_modules/);
    expect(realpathSync(join(wt, "node_modules"))).toBe(realpathSync(mainNm()));
  });

  it("catches a broken symlink; --fix repairs it", () => {
    settings(["node_modules"]);
    link(join(sb.root, "gone"));
    const bad = go([]);
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/broken symlink/);
    expect(go(["--fix"]).code).toBe(0);
    expect(readlinkSync(join(wt, "node_modules"))).toBe(mainNm());
  });

  it("reports an unfixable relink as unresolved, not OK", () => {
    // A read-only parent directory makes the unlink fail.
    settings(["sub/node_modules"]);
    mkdirSync(join(wt, "sub"));
    mkdirSync(join(sb.repo, "sub", "node_modules"), { recursive: true });
    symlinkSync(join(sb.root, "gone"), join(wt, "sub", "node_modules"));
    chmodSync(join(wt, "sub"), 0o555);
    try {
      const r = go(["--fix"]);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/failed to relink/);
    } finally {
      chmodSync(join(wt, "sub"), 0o755);
    }
  });

  it("leaves a materialized real directory untouched", () => {
    settings(["node_modules"]);
    mkdirSync(join(wt, "node_modules"));
    expect(go(["--fix"]).code).toBe(0);
    expect(lstatSync(join(wt, "node_modules")).isSymbolicLink()).toBe(false);
  });

  it("a missing entry is a silent no-op", () => {
    settings(["node_modules"]);
    expect(go([])).toEqual({ code: 0, out: "", err: "" });
  });

  it("a symlink whose main-checkout counterpart is missing is unresolved", () => {
    settings(["vendor"]);
    symlinkSync(join(sb.root, "x"), join(wt, "vendor"));
    const r = go(["--fix"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/has no vendor to point at/);
  });

  it("the main checkout is a no-op", () => {
    expect(go([], sb.repo)).toEqual({ code: 0, out: "", err: "" });
  });

  it("no settings.json, empty list, or null is a silent no-op", () => {
    expect(go([]).code).toBe(0);
    settings([]);
    expect(go([]).code).toBe(0);
    settings(null);
    expect(go([]).code).toBe(0);
    put(join(wt, ".claude", "settings.json"), "{}");
    expect(go([]).code).toBe(0);
  });

  it("an earlier unfixable entry's failure survives a later entry's successful --fix", () => {
    mkdirSync(join(sb.repo, "b"));
    settings(["a", "b"]);
    symlinkSync(join(sb.root, "x"), join(wt, "a")); // main has no "a"
    symlinkSync(join(sb.root, "gone"), join(wt, "b")); // fixable
    const r = go(["--fix"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/relinked b/);
  });

  it("malformed JSON exits 3", () => {
    put(join(wt, ".claude", "settings.json"), "{not json");
    expect(go([]).code).toBe(3);
  });

  it("a non-array symlinkDirectories exits 3", () => {
    settings({ a: "b" });
    const r = go([]);
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/must be an array, got object/);
  });

  it("a non-object worktree section exits 3", () => {
    put(join(wt, ".claude", "settings.json"), '{"worktree":"x"}');
    expect(go([]).code).toBe(3);
  });

  it("rejects '..' and absolute entries and non-strings, never touching them", () => {
    const outside = join(sb.root, "outside");
    mkdirSync(outside);
    settings(["../outside", "/etc", 5]);
    const r = go(["--fix"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/'\.\.' segment/);
    expect(r.err).toMatch(/absolute path/);
    expect(r.err).toMatch(/not a string/);
    expect(existsSync(outside)).toBe(true);
  });

  it("--help prints usage; unknown args exit 2; non-repo exits 2", () => {
    const h = go(["--help"]);
    expect(h.code).toBe(0);
    expect(h.out).toMatch(/^Usage: verify-worktree-symlinks/);
    expect(go(["--nope"]).code).toBe(2);
    expect(go([], sb.root).code).toBe(2);
  });
});
