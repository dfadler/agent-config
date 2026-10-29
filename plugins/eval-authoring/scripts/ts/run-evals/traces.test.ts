import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toolCalls } from "./summary.ts";
import { replyFiles, runCount } from "./traces.ts";

const fx = (n: string): string => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");

const HOME = "/Users/x";
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

  it("writes one file per run of both arms from the real result under the case name, naming the case, arm and run", () => {
    const files = replyFiles("/r/replies/01-c", result, () => trace, HOME);
    expect(files.map((f) => f.path)).toEqual(
      ["with-1", "with-2", "with-3", "without-1", "without-2", "without-3"].map(
        (n) => `/r/replies/01-c/capture-routes-person-note/${n}.md`,
      ),
    );
    const text = files[0]?.text ?? "";
    expect(text).toContain("# capture-routes-person-note: with arm, run 1");
    expect(text).toContain("score 1.00; failed graders: none");
    expect(text).toContain('1. Skill {"skill":"second-brain:capture"');
    expect(text).toContain("## Final reply\n\n50 People/Priya Raman.md");
    expect(text).toContain("# Priya Raman");
  });

  it("skips a run whose trace is gone or whose tracePath is relative, and names the failed graders and error of one it has", () => {
    const reads: string[] = [];
    const text = JSON.stringify({
      cases: [{
        name: "a b",
        arms: {
          with: [
            { score: 0, error: "turn limit", tracePath: "/gone", graders: [{ name: "g", passed: false }] },
            { score: 0.5, error: null, tracePath: "/kept", graders: [{ name: "g", passed: false }, { name: "h", passed: true }] },
            { score: 1, error: null, tracePath: "relative/trace.jsonl" },
          ],
          without: [],
        },
      }],
    });
    const files = replyFiles("/d", text, (p) => {
      reads.push(p);
      return p === "/kept" ? line([{ type: "tool_use", name: "Read", input: { file_path: "a" } }]) : undefined;
    }, HOME);
    expect(files.map((f) => f.path)).toEqual(["/d/a_b/with-2.md"]);
    expect(reads).toEqual(["/gone", "/kept"]);
    expect(files[0]?.text).toContain("score 0.50; failed graders: g");
    expect(files[0]?.text).toContain("(no final assistant message)");
    expect(files[0]?.text).toContain('1. Read {"file_path":"a"}');
    expect(runCount(text)).toBe(3);
    expect(runCount("{nope")).toBe(0);
  });

  it("redacts the reply and tool inputs, keeps the reply's newlines, and is empty for unreadable result text", () => {
    const text = JSON.stringify({ cases: [{ name: "c", arms: { with: [{ score: 1, tracePath: "/t" }] } }] });
    const kept = [
      line([{ type: "tool_use", name: "Bash", input: { command: `curl -H "Authorization: Bearer ${FAKE_TOKEN}"` } }]),
      line([{ type: "text", text: `line one\nline two token=${FAKE_TOKEN}` }]),
    ].join("\n");
    const [file] = replyFiles("/d", text, () => kept, HOME);
    expect(file?.text).not.toContain(FAKE_TOKEN);
    expect(file?.text).toContain("token=[REDACTED]");
    expect(file?.text).toContain("line one\nline two");
    expect(replyFiles("/d", "{nope", () => kept, HOME)).toEqual([]);
    expect(replyFiles("/d", undefined, () => kept, HOME)).toEqual([]);
  });

  it("shows the home directory as ~ so repo paths survive redaction, leaving a longer user name alone", () => {
    const text = JSON.stringify({ cases: [{ name: "c", arms: { with: [{ score: 1, tracePath: "/t" }] } }] });
    const kept = [
      line([{ type: "tool_use", name: "Read", input: { file_path: `${HOME}/dev/agent-config/traces.ts` } }]),
      line([{ type: "text", text: `edited ${HOME}/dev/agent-config/README.md; not ${HOME}avier/x` }]),
    ].join("\n");
    const [file] = replyFiles("/d", text, () => kept, HOME);
    expect(file?.text).toContain('1. Read {"file_path":"~/dev/agent-config/traces.ts"}');
    expect(file?.text).toContain(`edited ~/dev/agent-config/README.md; not ${HOME}avier/x`);
    // Without the mask the same path is one long run of path characters, which redact's catch-all eats.
    expect(replyFiles("/d", text, () => kept, "/nowhere")[0]?.text).toContain('1. Read {"file_path":"[REDACTED].ts"}');
  });

  it("labels the reply of a trace cut mid-line as the last complete assistant message", () => {
    const text = JSON.stringify({ cases: [{ name: "c", arms: { with: [{ score: 1, tracePath: "/t" }] } }] });
    const whole = [line([{ type: "text", text: "done" }]), JSON.stringify({ type: "result" })].join("\n");
    const cut = `${line([{ type: "text", text: "done" }])}\n{"type":"assistant","message":{"content":[{"type":"te`;
    expect(replyFiles("/d", text, () => whole, HOME)[0]?.text).toContain("## Final reply\n\ndone");
    expect(replyFiles("/d", text, () => cut, HOME)[0]?.text).toContain("## Last complete assistant message\n\ndone");
  });
});
