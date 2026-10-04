/**
 * EVAL015 asks git, so these tests build throwaway repositories in a temp
 * directory (no network, no real repo) to cover what the committed fixtures
 * cannot: a clean checkout, no repository at all, and a global excludes file
 * that must not mask the defect.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lintPlugin } from "../runner.ts";
import { rule } from "./eval015-results-ignored.ts";

const CASE = `schema_version: "1.1"\nname: c\nexecution:\n  prompt: Do it.\ngraders:\n  - type: regex\n    pattern: done\n`;

let tmp = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "eval015-"));
});
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]): void => {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};

/** A plugin with one case; optionally a git repo, optionally a .gitignore. */
const makePlugin = (
  name: string,
  opts: { readonly repo: boolean; readonly gitignore?: string },
): string => {
  const root = join(tmp, name);
  mkdirSync(join(root, "evals", "c"), { recursive: true });
  writeFileSync(join(root, "evals", "c", "case.yaml"), CASE);
  if (opts.repo) git(root, ["init", "-q"]);
  if (opts.gitignore !== undefined) {
    writeFileSync(join(root, ".gitignore"), opts.gitignore);
  }
  return root;
};

const fires = (root: string): number => {
  const outcome = lintPlugin(root, [rule]);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.filter((f) => f.ruleId === "EVAL015").length;
};

describe("EVAL015 in a throwaway repository", () => {
  it("fires in a fresh repo that does not ignore results/", () => {
    expect(fires(makePlugin("no-ignore", { repo: true }))).toBe(1);
  });

  it("is quiet when .gitignore names the results directory", () => {
    expect(fires(makePlugin("dir", { repo: true, gitignore: "evals/results/\n" }))).toBe(0);
    expect(fires(makePlugin("glob", { repo: true, gitignore: "**/results/\n" }))).toBe(0);
  });

  it("works for a plugin root given as a relative path", () => {
    const root = makePlugin("relative", { repo: true });
    expect(fires(relative(process.cwd(), root))).toBe(1);
  });

  it("fires when .gitignore ignores something else", () => {
    expect(fires(makePlugin("other", { repo: true, gitignore: "node_modules/\n" }))).toBe(1);
  });

  it("is a no-op when the plugin is not in a git repository", () => {
    expect(fires(makePlugin("no-repo", { repo: false }))).toBe(0);
  });

  it("is a no-op when there is no eval directory", () => {
    const root = join(tmp, "no-evals");
    mkdirSync(root, { recursive: true });
    git(root, ["init", "-q"]);
    expect(fires(root)).toBe(0);
  });

  it("is not masked by a global excludes file", () => {
    const root = makePlugin("global", { repo: true });
    const home = join(tmp, "home");
    mkdirSync(join(home, ".config", "git"), { recursive: true });
    writeFileSync(join(home, ".config", "git", "ignore"), "results/\n");
    const saved = { HOME: process.env["HOME"], XDG: process.env["XDG_CONFIG_HOME"] };
    process.env["HOME"] = home;
    process.env["XDG_CONFIG_HOME"] = join(home, ".config");
    try {
      expect(fires(root)).toBe(1);
    } finally {
      if (saved.HOME === undefined) delete process.env["HOME"];
      else process.env["HOME"] = saved.HOME;
      if (saved.XDG === undefined) delete process.env["XDG_CONFIG_HOME"];
      else process.env["XDG_CONFIG_HOME"] = saved.XDG;
    }
  });
});
