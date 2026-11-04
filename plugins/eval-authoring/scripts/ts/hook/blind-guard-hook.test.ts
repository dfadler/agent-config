// The guard makes blind-case-writer's "never read evals/" prose untestable by an
// eval on purpose: the hook, not the prose, is what is pinned here. Unverified:
// whether the hook fires for a subagent inside `claude plugin eval`, and the exact
// agent_type string of a plugin subagent (the hook suffix-matches).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { decide, globToRegExp } from "./blind-guard-hook.ts";

const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOOK = join(pluginRoot, "scripts", "ts", "hook", "blind-guard-hook.ts");

const run = (stdin: string) =>
  spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8" });

const call = (tool: string, toolInput: object, agentType?: string): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: toolInput,
    ...(agentType === undefined ? {} : { agent_type: agentType, agent_id: "a1" }),
  });

const BLIND = "eval-authoring:blind-case-writer";

describe("blind-guard-hook", () => {
  it.each([
    ["Read", { file_path: "/r/plugins/p/evals/c/case.yaml" }],
    ["Read", { file_path: "/r/plugins/p/evals/grants.yaml" }],
    ["Read", { file_path: "/r/plugins/p/evals/results/run-1/aggregate-result.json" }],
    ["Read", { file_path: "other/case.yaml" }],
    ["Glob", { pattern: "**/evals/**" }],
    ["Glob", { pattern: "*.yaml", path: "/r/plugins/p/evals" }],
    ["Grep", { pattern: "x", path: "/r/plugins/p/evals/results" }],
    ["Grep", { pattern: "x", glob: "**/case.yaml" }],
  ])("blocks %s %j for the blind agent (exit 2, reason on stderr)", (tool, input) => {
    const r = run(call(tool, input, BLIND));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("blind-case-writer");
  });

  it("matches the agent by suffix, with or without a plugin prefix", () => {
    const input = { file_path: "/p/evals/c/case.yaml" };
    expect(run(call("Read", input, "blind-case-writer")).status).toBe(2);
    expect(run(call("Read", input, "x:blind-case-writer")).status).toBe(2);
  });

  it.each([
    ["Read", { file_path: "/r/plugins/p/skills/s/SKILL.md" }],
    ["Read", { file_path: "/r/plugins/p/.claude-plugin/plugin.json" }],
    ["Read", { file_path: "/r/plugins/p/skills/s/evals-notes.md" }],
    ["Glob", { pattern: "skills/**/*.md" }],
    ["Grep", { pattern: "evals/ and case.yaml in prose", path: "/r/plugins/p/skills" }],
  ])("allows %s %j for the blind agent", (tool, input) => {
    const r = run(call(tool, input, BLIND));
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("allows the same forbidden read for the parent session and other agents", () => {
    const input = { file_path: "/r/plugins/p/evals/c/case.yaml" };
    expect(run(call("Read", input)).status).toBe(0);
    expect(run(call("Read", input, "eval-authoring:case-reviewer")).status).toBe(0);
  });

  it.each(["", "{{{", "null", "[]", "42", '{"agent_type":5}', `{"agent_type":"${BLIND}","tool_input":"x"}`])(
    "fails open on malformed payload %j",
    (raw) => {
      expect(run(raw).status).toBe(0);
    },
  );
});

const verdict = (tool: string, toolInput: object): number => decide(call(tool, toolInput, BLIND)).code;

describe("directory scope (decide, imported without running the entrypoint)", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("allows a checkout that merely lives under a directory called results/ or evals/", () => {
    expect(verdict("Read", { file_path: "/home/dev/results/project/plugins/p/skills/s/SKILL.md" })).toBe(0);
    expect(verdict("Read", { file_path: "/home/dev/evals/project/plugins/p/skills/s/SKILL.md" })).toBe(0);
  });

  it.each([
    "/home/dev/results/project/plugins/p/evals/x/case.yaml",
    "/home/dev/results/project/plugins/p/evals/x/prompt.md",
    "plugins/p/evals/x/prompt.md",
    "evals/x/prompt.md",
    "./evals/x/prompt.md",
    "results/run-1/aggregate-result.json",
  ])("blocks %s", (file_path) => {
    expect(verdict("Read", { file_path })).toBe(2);
  });

  it("blocks evals/ under a directory that holds .claude-plugin/plugin.json, and only there", () => {
    const root = mkdtempSync(join(tmpdir(), "blind-guard-"));
    roots.push(root);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{}");
    expect(verdict("Read", { file_path: join(root, "evals", "x", "prompt.md") })).toBe(2);
    expect(verdict("Read", { file_path: join(root, "results", "r", "a.json") })).toBe(2);
    expect(verdict("Read", { file_path: join(root, "skills", "s", "SKILL.md") })).toBe(0);
    const bare = mkdtempSync(join(tmpdir(), "blind-guard-"));
    roots.push(bare);
    expect(verdict("Read", { file_path: join(bare, "evals", "x", "prompt.md") })).toBe(0);
  });
});

describe("globs that can reach protected paths", () => {
  it.each(["**", "**/*", "**/*.yaml", "**/*.md", "evals/**", "{evals,skills}/**", "*/*/case.yaml", "plugins/p/**", "plugins/p/**/*.yaml"])(
    "blocks Glob pattern and Grep glob %s",
    (pattern) => {
      expect(verdict("Glob", { pattern })).toBe(2);
      expect(verdict("Grep", { pattern: "x", glob: pattern })).toBe(2);
    },
  );

  it("joins the search path onto the pattern", () => {
    const root = mkdtempSync(join(tmpdir(), "blind-guard-"));
    try {
      mkdirSync(join(root, ".claude-plugin"), { recursive: true });
      writeFileSync(join(root, ".claude-plugin", "plugin.json"), "{}");
      expect(verdict("Glob", { pattern: "**/*.yaml", path: root })).toBe(2);
      expect(verdict("Glob", { pattern: "skills/**/*.md", path: root })).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["**/SKILL.md", "**/author-cases/**", "skills/*/SKILL.md", "*.md", "plugins/p/skills/**/*.md"])(
    "allows Glob pattern and Grep glob %s",
    (pattern) => {
      expect(verdict("Glob", { pattern })).toBe(0);
      expect(verdict("Grep", { pattern: "x", glob: pattern })).toBe(0);
    },
  );

  it("globToRegExp translates the supported syntax and escapes the rest", () => {
    expect(globToRegExp("a/**/b.{md,txt}").test("a/x/y/b.txt")).toBe(true);
    expect(globToRegExp("a/**/b").test("a/b")).toBe(true);
    expect(globToRegExp("a/?.md").test("a/xy.md")).toBe(false);
    expect(globToRegExp("a.md").test("aXmd")).toBe(false);
    expect(globToRegExp("*.md").test("d/x.md")).toBe(false);
  });
});

describe("entrypoint", () => {
  it("reads stdin and exits 2 when run directly", () => {
    const r = run(call("Read", { file_path: "evals/x/case.yaml" }, BLIND));
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Blocked");
  });

  it("runs through a symlink to the script", () => {
    const dir = mkdtempSync(join(tmpdir(), "blind-guard-link-"));
    try {
      const link = join(dir, "hook.ts");
      symlinkSync(HOOK, link);
      const r = spawnSync(process.execPath, [link], {
        input: call("Read", { file_path: "evals/x/case.yaml" }, BLIND),
        encoding: "utf8",
      });
      expect(r.status).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("importing it does not run the hook (decide is a plain function, no exit, no stdin read)", () => {
    expect(decide("{{{")).toEqual({ code: 0, message: "" });
  });
});

describe("registration", () => {
  it("hooks.json registers the guard as a PreToolUse hook on Read|Glob|Grep", () => {
    const registered: unknown = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
    expect(registered).toMatchObject({
      hooks: { PreToolUse: [{ matcher: "Read|Glob|Grep", hooks: [{ type: "command" }] }] },
    });
    expect(JSON.stringify(registered)).toContain("blind-guard-hook.ts");
  });

  it("blind-case-writer keeps exactly the tools Read, Glob", () => {
    const text = readFileSync(join(pluginRoot, "agents", "blind-case-writer.md"), "utf8");
    const tools = /^tools:\s*(.+)$/m.exec(text)?.[1] ?? "";
    expect(tools.split(",").map((t) => t.trim())).toEqual(["Read", "Glob"]);
  });
});
