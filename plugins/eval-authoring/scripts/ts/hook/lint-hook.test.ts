import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findPluginRoot,
  hookOutput,
  parseInput,
  runHook,
  scopeOf,
  type LintFn,
} from "./lint-hook.ts";

const WRAPPER = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "hooks",
  "scripts",
  "lint-on-edit.sh",
);

const GOOD_CASE = [
  'schema_version: "1.1"',
  "name: good",
  "execution:",
  "  prompt: Do the thing.",
  "graders:",
  "  - name: says-done",
  "    type: regex",
  "    target: last_message",
  "    pattern: done",
  "    match: contains",
  "  - name: reads-first",
  "    type: tool_used",
  "    tool: Read",
  "",
].join("\n");

/** No grader: EVAL001 fires. */
const BAD_CASE = [
  'schema_version: "1.1"',
  "name: bad",
  "execution:",
  "  prompt: Do the thing.",
  "",
].join("\n");

const roots: string[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => {
    rmSync(r, { recursive: true, force: true });
  });
});

const write = (root: string, rel: string, text: string): string => {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
};

/** A throwaway plugin with a good and a bad case under evals/. */
const makePlugin = (manifest = "{}"): string => {
  const root = mkdtempSync(join(tmpdir(), "eval-hook-"));
  roots.push(root);
  write(root, ".claude-plugin/plugin.json", manifest);
  write(root, "evals/good/case.yaml", GOOD_CASE);
  write(root, "evals/bad/case.yaml", BAD_CASE);
  return root;
};

const event = (file: string, tool = "Write"): string =>
  JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: tool,
    cwd: "/",
    tool_input: { file_path: file },
  });

interface HookContext {
  readonly hookEventName: string;
  readonly additionalContext: string;
}

/** Parse the hook's stdout, failing the test if it is not the documented shape. */
const contextOf = (stdout: string): HookContext => {
  const parsed: unknown = JSON.parse(stdout);
  const out =
    typeof parsed === "object" && parsed !== null && "hookSpecificOutput" in parsed
      ? parsed.hookSpecificOutput
      : undefined;
  if (
    typeof out === "object" &&
    out !== null &&
    "hookEventName" in out &&
    typeof out.hookEventName === "string" &&
    "additionalContext" in out &&
    typeof out.additionalContext === "string"
  ) {
    return {
      hookEventName: out.hookEventName,
      additionalContext: out.additionalContext,
    };
  }
  throw new Error(`not a hook output: ${stdout}`);
};

describe("runHook: in scope", () => {
  it("reports lint findings for an edited case as additionalContext", async () => {
    const root = makePlugin();
    const out = await runHook(event(join(root, "evals/bad/case.yaml")));
    const ctx = contextOf(out);
    expect(ctx.hookEventName).toBe("PostToolUse");
    expect(ctx.additionalContext).toContain("EVAL001");
    expect(ctx.additionalContext).toContain("Fix:");
    expect(ctx.additionalContext).toContain("Source:");
    expect(ctx.additionalContext).toContain("nothing was blocked");
  });

  it("stays silent when the edited case is clean, even if another case is not", async () => {
    const root = makePlugin();
    const out = await runHook(event(join(root, "evals/good/case.yaml"), "Edit"));
    expect(out).toBe("");
  });

  it("reports every case when a file directly under the eval directory is edited", async () => {
    const root = makePlugin();
    const out = await runHook(event(join(root, "evals/grants.yaml")));
    expect(contextOf(out).additionalContext).toContain("EVAL001");
  });

  it("follows the manifest's experimental.evals", async () => {
    const root = makePlugin('{"experimental":{"evals":"checks"}}');
    const file = write(root, "checks/bad/case.yaml", BAD_CASE);
    const out = await runHook(event(file));
    expect(contextOf(out).additionalContext).toContain("EVAL001");
    expect(await runHook(event(join(root, "evals/bad/case.yaml")))).toBe("");
  });
});

describe("runHook: no-op", () => {
  it("is silent for a file outside the eval directory", async () => {
    const root = makePlugin();
    const file = write(root, "skills/x/SKILL.md", "hi");
    expect(await runHook(event(file))).toBe("");
  });

  it("is silent under tests/, where deliberately bad fixtures live", async () => {
    const root = makePlugin();
    const file = write(root, "tests/lint-fixtures/X/bad/evals/bad/case.yaml", BAD_CASE);
    expect(await runHook(event(file))).toBe("");
    const inEvals = write(root, "evals/tests/bad/case.yaml", BAD_CASE);
    expect(await runHook(event(inEvals))).toBe("");
  });

  it("is silent outside any plugin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "eval-hook-bare-"));
    roots.push(dir);
    const file = write(dir, "evals/bad/case.yaml", BAD_CASE);
    expect(await runHook(event(file))).toBe("");
  });

  it("is silent for other tools, missing paths and garbage input", async () => {
    const root = makePlugin();
    const file = join(root, "evals/bad/case.yaml");
    expect(await runHook(event(file, "Read"))).toBe("");
    expect(await runHook(JSON.stringify({ tool_name: "Write", tool_input: {} }))).toBe("");
    expect(await runHook("not json")).toBe("");
    expect(await runHook("")).toBe("");
    expect(await runHook("[]")).toBe("");
  });

  it("is silent when the eval directory or grants file is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "eval-hook-nodir-"));
    roots.push(root);
    write(root, ".claude-plugin/plugin.json", "{}");
    const file = join(root, "evals/new/case.yaml");
    expect(await runHook(event(file))).toBe("");
    write(root, "evals/new/case.yaml", GOOD_CASE);
    expect(await runHook(event(file))).toBe("");
  });

  it("is silent when the manifest names an unusable eval directory", async () => {
    const root = makePlugin('{"experimental":{"evals":"../outside"}}');
    expect(await runHook(event(join(root, "evals/bad/case.yaml")))).toBe("");
  });
});

describe("runHook: failure containment", () => {
  it("returns nothing when the lint throws", async () => {
    const root = makePlugin();
    const crash: LintFn = () => Promise.reject(new Error("boom"));
    const out = await runHook(event(join(root, "evals/bad/case.yaml")), crash);
    expect(out).toBe("");
  });

  it("returns nothing when the lint refuses the plugin", async () => {
    const root = makePlugin();
    const refuse: LintFn = () =>
      Promise.resolve({ ok: false, reason: "bad", source: "manifest" });
    expect(await runHook(event(join(root, "evals/bad/case.yaml")), refuse)).toBe("");
  });
});

describe("helpers", () => {
  it("findPluginRoot picks the nearest plugin", () => {
    const outer = makePlugin();
    write(outer, "nested/.claude-plugin/plugin.json", "{}");
    const file = join(outer, "nested/evals/a/case.yaml");
    expect(findPluginRoot(file)).toBe(join(outer, "nested"));
  });

  it("parseInput resolves a relative path against cwd", () => {
    const raw = JSON.stringify({
      tool_name: "Edit",
      cwd: "/work/p",
      tool_input: { file_path: "evals/a/case.yaml" },
    });
    expect(parseInput(raw)?.filePath).toBe("/work/p/evals/a/case.yaml");
  });

  it("scopeOf reports the first segment under the eval directory", () => {
    const root = makePlugin();
    expect(scopeOf(join(root, "evals/bad/case.yaml"))?.firstSegment).toBe("bad");
    expect(scopeOf(join(root, "evals/grants.yaml"))?.firstSegment).toBeUndefined();
  });

  it("hookOutput is the documented JSON shape", () => {
    expect(JSON.parse(hookOutput("x"))).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "x" },
    });
  });
});

describe("lint-on-edit.sh (the shipped entry point)", () => {
  const run = (stdin: string, path?: string) =>
    spawnSync("/bin/bash", [WRAPPER], {
      input: stdin,
      encoding: "utf8",
      env: { ...process.env, ...(path === undefined ? {} : { PATH: path }) },
    });

  it("reports findings end to end and exits 0", () => {
    const root = makePlugin();
    const r = run(event(join(root, "evals/bad/case.yaml")));
    expect(r.status).toBe(0);
    expect(contextOf(r.stdout).additionalContext).toContain("EVAL001");
  });

  it("is silent and exits 0 for an out-of-scope path", () => {
    const root = makePlugin();
    const r = run(event(write(root, "README.md", "hi")));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("is silent and exits 0 for garbage input", () => {
    const r = run("{{{");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("is silent and exits 0 when node is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "eval-hook-path-"));
    roots.push(empty);
    const root = makePlugin();
    const r = run(event(join(root, "evals/bad/case.yaml")), empty);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("exits 0 when node exists but fails (too old to run .ts)", () => {
    const bin = mkdtempSync(join(tmpdir(), "eval-hook-oldnode-"));
    roots.push(bin);
    write(bin, "node", "#!/bin/sh\necho 'unknown file extension' >&2\nexit 9\n");
    chmodSync(join(bin, "node"), 0o755);
    const root = makePlugin();
    const r = run(event(join(root, "evals/bad/case.yaml")), `${bin}:/usr/bin:/bin`);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("works through a symlinked plugin directory", () => {
    const root = makePlugin();
    const link = join(mkdtempSync(join(tmpdir(), "eval-hook-link-")), "p");
    roots.push(dirname(link));
    symlinkSync(root, link);
    const r = run(event(join(link, "evals/bad/case.yaml")));
    expect(r.status).toBe(0);
    expect(contextOf(r.stdout).additionalContext).toContain("EVAL001");
  });

  it("prints usage for --help", () => {
    const r = spawnSync("/bin/bash", [WRAPPER, "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: lint-on-edit.sh");
  });
});
