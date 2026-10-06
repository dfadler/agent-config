import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliResult } from "./lint/cli.ts";
import { main, type Lint } from "./lint-repo.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-repo-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const plugin = (name: string, withEvals: boolean): string => {
  const dir = join(root, "plugins", name);
  mkdirSync(join(dir, withEvals ? "evals" : "skills"), { recursive: true });
  return dir;
};

const run = async (argv: readonly string[], lint: Lint) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, (s) => out.push(s), (s) => err.push(s), lint);
  return { code, out: out.join(""), err: err.join("\n") };
};

const result = (code: CliResult["code"], stdout: string, stderr = ""): CliResult => ({
  code,
  stdout,
  stderr,
});

describe("lint-repo main", () => {
  it("prints usage for --help", async () => {
    const r = await run(["--help"], () => Promise.reject(new Error("unused")));
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage: lint-repo.ts");
  });

  it("is a usage error when ROOT has no plugins/", async () => {
    const r = await run([root], () => Promise.reject(new Error("unused")));
    expect(r.code).toBe(2);
    expect(r.err).toContain("no plugins/ directory");
  });

  it("lints only plugins with an evals/ directory and prints their summary lines", async () => {
    const a = plugin("a", true);
    plugin("b", false);
    const seen: string[] = [];
    const r = await run([root], (argv) => {
      seen.push(...argv);
      return Promise.resolve(result(0, "header\n0 error(s) in a\n"));
    });
    expect(seen).toEqual([a]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("0 error(s) in a\n");
  });

  it("fails and prints the full report when any plugin has an error", async () => {
    plugin("a", true);
    plugin("b", true);
    const r = await run([root], ([dir]) =>
      Promise.resolve(
        dir?.endsWith("/b") === true
          ? result(1, "b.yaml:1:1: error EVAL004: bad\n1 error(s) in b\n")
          : result(0, "0 error(s) in a\n"),
      ),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("error EVAL004");
    expect(r.out).toContain("0 error(s) in a");
    expect(r.err).toContain("lint exited 1");
  });

  it("fails when the lint cannot run, and reports its stderr", async () => {
    plugin("a", true);
    const r = await run([root], () => Promise.resolve(result(20, "", "boom\n")));
    expect(r.code).toBe(1);
    expect(r.err).toContain("boom");
  });
});
