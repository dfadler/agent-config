import { describe, expect, it } from "vitest";
import { run } from "./scratch-guard-hook.ts";

const call = (file_path: unknown, env: Record<string, string> = {}, stdin?: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = run({
    env,
    stdin: stdin ?? JSON.stringify({ tool_input: { file_path } }),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  });
  return { code, out: out.join(""), err: err.join("") };
};

const SCRATCH = "/private/tmp/claude-501/-Users-me-proj/abc/scratchpad/x.txt";

describe("scratch-guard hook", () => {
  it.each(["/tmp/x.txt", "/private/tmp/x.txt", "/var/folders/tz/ab/T/x.txt"])(
    "warns on %s",
    (p) => {
      const r = call(p);
      expect(r.code).toBe(0);
      expect(r.out).toContain("additionalContext");
      expect(r.out).toContain(p);
    },
  );

  it("blocks in block mode", () => {
    const r = call("/tmp/x.txt", { SCRATCH_GUARD: "block" });
    expect(r.code).toBe(2);
    expect(r.err).toContain("/tmp/x.txt");
  });

  it.each([
    SCRATCH,
    "/tmp/claude-501/-Users-me-proj/abc/scratchpad/sub/y.txt",
    "/Users/me/proj/src/a.ts",
    "/tmp-notes/a.txt",
  ])("allows %s", (p) => {
    expect(call(p, { SCRATCH_GUARD: "block" })).toEqual({ code: 0, out: "", err: "" });
  });

  it("rejects a scratchpad lookalike outside the claude-<uid> layout", () => {
    expect(call("/tmp/evil/scratchpad/x.txt").out).not.toBe("");
  });

  it("is silent when off", () => {
    expect(call("/tmp/x.txt", { SCRATCH_GUARD: "off" }).out).toBe("");
  });

  it("fails open on bad input", () => {
    expect(call(undefined, {}, "not json")).toEqual({ code: 0, out: "", err: "" });
    expect(call(42)).toEqual({ code: 0, out: "", err: "" });
  });
});
