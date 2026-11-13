/**
 * The trust decision against the real filesystem: a plugin in one temp directory and the
 * wrapper's `plugins/` in another, with the real `realpath` (macOS /var vs /private/var
 * included) and no fake Io paths. `--dry-run --tier quick` spawns nothing and calls no model.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_USAGE } from "./exit-codes.ts";
import { nodeIo } from "./io.ts";
import { main } from "./run-evals.ts";
import { makePlugin } from "./test-support.ts";

const scratch: string[] = [];
afterEach(() => {
  scratch.splice(0).forEach((d) => {
    rmSync(d, { recursive: true, force: true });
  });
});

const plugin = (): string => {
  const root = makePlugin([{ name: "a", tags: ["quick"] }]);
  scratch.push(root);
  return root;
};

const otherPluginsDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "run-evals-plugins-"));
  scratch.push(dir);
  return dir;
};

/** Run the real wrapper in-process on `args`, capturing what it prints. */
const run = async (args: readonly string[], pluginsDir: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const io = { ...nodeIo(process.env), out: (t: string) => void out.push(t), err: (t: string) => void err.push(t) };
  const code = await main([...args], { io, pluginsDir });
  return { code, out: out.join(""), err: err.join("") };
};

describe("a plugin outside the wrapper's plugins/ directory, on the real filesystem", () => {
  it("plans the run with --trust-plugin when the user opts in", async () => {
    const root = plugin();
    const r = await run([root, "--dry-run", "--tier", "quick", "--trust-plugin"], otherPluginsDir());
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("--trust-plugin");
  });

  it("plans the run without --trust-plugin when the user does not opt in", async () => {
    const root = plugin();
    const r = await run([root, "--dry-run", "--tier", "quick"], otherPluginsDir());
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("claude plugin eval");
    expect(r.out).not.toContain("--trust-plugin");
  });

  it("still refuses --scaffold with --trust-plugin", async () => {
    const root = plugin();
    const r = await run([root, "--dry-run", "--tier", "quick", "--scaffold", "--trust-plugin"], otherPluginsDir());
    expect(r.code).toBe(EXIT_USAGE);
    expect(r.err).toContain("--scaffold");
  });

  it("trusts a plugin directly under plugins/ with no flag, after real path resolution", async () => {
    const root = plugin();
    const r = await run([root, "--dry-run", "--tier", "quick"], dirname(root));
    expect(r.code).toBe(EXIT_OK);
    expect(r.out).toContain("--trust-plugin");
  });
});
