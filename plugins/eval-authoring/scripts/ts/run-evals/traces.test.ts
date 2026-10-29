import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolCalls } from "./summary.ts";
import { replyFiles } from "./traces.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

const FAKE_TOKEN = `ghp_${"a1B2c3D4e5".repeat(3)}`;
const line = (content: readonly unknown[]): string =>
  JSON.stringify({ type: "assistant", message: { content } });

describe("toolCalls", () => {
  it("lists every tool_use block of a real trace, in order, with its input as JSON", () => {
    const calls = toolCalls(fx("real-trace.jsonl"));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("Skill");
    expect(calls[0]?.input).toContain('"skill":"second-brain:capture"');
  });
  it("is empty for no trace, a text-only trace, or non-assistant lines", () => {
    expect(toolCalls(undefined)).toEqual([]);
    expect(toolCalls(line([{ type: "text", text: "hi" }]))).toEqual([]);
    expect(toolCalls(JSON.stringify({ type: "user", message: { content: [{ type: "tool_use", name: "X" }] } }))).toEqual([]);
  });
});

describe("replyFiles", () => {
  const result = fx("real-aggregate-result.json");
  const trace = fx("real-trace.jsonl");

  it("writes one file per run of both arms from the real result, naming the case, arm and run", () => {
    const files = replyFiles("/r/replies/c", result, () => trace);
    expect(files.map((f) => f.path)).toEqual(
      ["with-1", "with-2", "with-3", "without-1", "without-2", "without-3"].map((n) => `/r/replies/c/${n}.md`),
    );
    const text = files[0]?.text ?? "";
    expect(text).toContain("# capture-routes-person-note: with arm, run 1");
    expect(text).toContain("score 1.00; failed graders: none");
    expect(text).toContain('1. Skill {"skill":"second-brain:capture"');
    expect(text).toContain("## Final reply\n\n50 People/Priya Raman.md");
    expect(text).toContain("# Priya Raman");
  });

  it("skips a run whose trace is gone, and names the failed graders and error of one it has", () => {
    const text = JSON.stringify({
      cases: [{
        name: "c",
        arms: {
          with: [
            { score: 0, error: "turn limit", tracePath: "/gone", graders: [{ name: "g", passed: false }] },
            { score: 0.5, error: null, tracePath: "/kept", graders: [{ name: "g", passed: false }, { name: "h", passed: true }] },
          ],
          without: [],
        },
      }],
    });
    const files = replyFiles("/d", text, (p) => (p === "/kept" ? line([{ type: "tool_use", name: "Read", input: { file_path: "a" } }]) : undefined));
    expect(files.map((f) => f.path)).toEqual(["/d/with-2.md"]);
    expect(files[0]?.text).toContain("score 0.50; failed graders: g");
    expect(files[0]?.text).toContain("(no final assistant message)");
    expect(files[0]?.text).toContain('1. Read {"file_path":"a"}');
  });

  it("redacts the reply and tool inputs, keeps the reply's newlines, and is empty for unreadable result text", () => {
    const text = JSON.stringify({ cases: [{ name: "c", arms: { with: [{ score: 1, tracePath: "/t" }] } }] });
    const kept = [
      line([{ type: "tool_use", name: "Bash", input: { command: `curl -H "Authorization: Bearer ${FAKE_TOKEN}"` } }]),
      line([{ type: "text", text: `line one\nline two token=${FAKE_TOKEN}` }]),
    ].join("\n");
    const [file] = replyFiles("/d", text, () => kept);
    expect(file?.text).not.toContain(FAKE_TOKEN);
    expect(file?.text).toContain("token=[REDACTED]");
    expect(file?.text).toContain("line one\nline two");
    expect(replyFiles("/d", "{nope", () => kept)).toEqual([]);
    expect(replyFiles("/d", undefined, () => kept)).toEqual([]);
  });
});
