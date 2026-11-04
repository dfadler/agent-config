import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analyze, analyzeText, main } from "./actors.ts";

const FIXTURE = new URL("./fixtures/real-subagent-trace.jsonl", import.meta.url);

const call = (id: string, name: string, input: unknown, sub?: string) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
    parent_tool_use_id: sub ?? null,
    ...(sub === undefined ? {} : { agent_id: "a1" }),
  });
const result = (id: string, content: unknown, isError?: boolean, sub?: string) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
    parent_tool_use_id: sub ?? null,
  });
const PROBE = "node check-replies.ts --probe c --reply - planted <<'X'\nhi\nX";

describe("analyze on a real trimmed trace", () => {
  const a = analyze(FIXTURE.pathname);

  it("splits parent and subagent tool calls by parent_tool_use_id", () => {
    expect(a.parentCalls).toEqual({ Agent: 1 });
    expect(a.subagentCalls).toEqual({ Glob: 1, Bash: 3, Read: 1 });
  });
  it("lists the subagent call that read an evals/ path", () => {
    expect(a.subagentEvalsTouches).toEqual(["Read /sandbox/cwd/planted/evals/release-notes-deprecation/case.yaml"]);
  });
  it("names each denial's kind: a missing tool, and Bash denied by don't ask mode", () => {
    expect(a.denied.map((d) => [d.actor, d.tool, d.kind])).toEqual([
      ["subagent", "Glob", "tool-unavailable"],
      ["subagent", "Bash", "dont-ask-mode"],
    ]);
  });
  it("does not count a denied --probe call as a run", () => {
    expect(a.probeRuns).toEqual({ parent: 0, subagent: 0 });
  });
  it("gives the subagent's type, status, call count and final report", () => {
    expect(a.agents).toHaveLength(1);
    expect(a.agents[0]).toMatchObject({ type: "eval-authoring:grader-red-team", status: "completed", calls: 5 });
    expect(a.agents[0]?.final).toContain("The probe did not run");
  });
});

describe("analyzeText", () => {
  it("counts a --probe Bash call that returned without an error, by actor", () => {
    const a = analyzeText(
      "t",
      [
        call("p1", "Bash", { command: PROBE }),
        result("p1", "ok"),
        call("s1", "Bash", { command: PROBE }, "tu"),
        result("s1", "pass\nfail", false, "tu"),
        call("s2", "Bash", { command: PROBE }, "tu"),
        result("s2", "boom", true, "tu"),
        call("s3", "Bash", { command: "ls" }, "tu"),
        result("s3", "x", false, "tu"),
      ].join("\n"),
    );
    expect(a.probeRuns).toEqual({ parent: 1, subagent: 1 });
  });

  it("reads the Bash-disabled error as an unavailable tool and a permission error as a denial", () => {
    const a = analyzeText(
      "t",
      [
        call("b", "Bash", { command: "ls" }, "tu"),
        result("b", "<tool_use_error>Error: No such tool available: Bash. Bash is disabled for this session, in subagents as well as here.</tool_use_error>", true, "tu"),
        call("r", "Read", { file_path: "/x/evals/c/case.yaml" }, "tu"),
        result("r", "Permission to use Read has been denied.", true, "tu"),
        call("ok", "Read", { file_path: "/x/y" }, "tu"),
        result("ok", "the word denied permission in a good result", false, "tu"),
      ].join("\n"),
    );
    expect(a.denied.map((d) => [d.tool, d.kind])).toEqual([["Bash", "tool-unavailable"], ["Read", "permission-denied"]]);
    // The denied Read still names an evals/ path, so a zero count would be vacuous; here it is 1 and the denial is listed beside it.
    expect(a.subagentEvalsTouches).toHaveLength(1);
  });

  it("does not match a path that only contains the word evals", () => {
    const a = analyzeText("t", call("g", "Glob", { pattern: "retrievals/*" }, "tu"));
    expect(a.subagentEvalsTouches).toEqual([]);
  });

  it("tolerates garbage lines, missing ids and fields, and a subagent with no notification", () => {
    const text = [
      "not json",
      "",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "report body" }] }, parent_tool_use_id: "tu", agent_id: "a9" }),
      JSON.stringify({ type: "system", subtype: "permission_denied" }),
      JSON.stringify({ type: "result" }),
    ].join("\n");
    const a = analyzeText("t", text);
    expect(a.parentCalls).toEqual({});
    expect(a.denied).toEqual([]);
    expect(a.agents).toEqual([{ agentId: "a9", type: undefined, status: undefined, calls: 0, final: "report body" }]);
  });
});

describe("main", () => {
  const read = (p: string): string | undefined => (p === "t.jsonl" ? readFileSync(FIXTURE, "utf8") : undefined);

  it("prints help with the keep-temp and vacuous-zero caveats, exit 0", () => {
    const out = main(["--help"], read);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("--keep-temp");
    expect(out.stdout).toContain("vacuous when reads were denied");
  });
  it("exits 2 with no trace or an unknown option, and 1 for a trace it cannot read", () => {
    expect(main([], read).code).toBe(2);
    expect(main(["--nope", "t.jsonl"], read).code).toBe(2);
    const missing = main(["t.jsonl", "gone.jsonl"], read);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("gone.jsonl");
  });
  it("prints one JSON object per trace with --json and a text report otherwise", () => {
    const json = main(["--json", "t.jsonl"], read);
    expect(JSON.parse(json.stdout.trim())).toMatchObject({ parentCalls: { Agent: 1 } });
    const text = main(["t.jsonl"], read);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("[dont-ask-mode]");
    expect(text.stdout).toContain("subagent calls touching evals/: 1");
  });
});
