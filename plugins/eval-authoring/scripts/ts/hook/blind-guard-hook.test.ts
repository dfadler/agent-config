// The guard makes blind-case-writer's "never read evals/" prose untestable by an
// eval on purpose: the hook, not the prose, is what is pinned here. Unverified:
// whether the hook fires for a subagent inside `claude plugin eval`, and the exact
// agent_type string of a plugin subagent (the hook suffix-matches).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
