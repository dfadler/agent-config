import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadBadReply } from "./check-replies.ts";
import { assess, atCeiling, CEILING, probeCase, regexPasses } from "./discrimination.ts";
import { readSuite, type EvalCase, type RegexGrader } from "./parser/index.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "discrimination-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const REGEX = (pattern: string, extra = ""): string =>
  `  - name: g\n    type: regex\n    pattern: '${pattern}'\n${extra}`;
const LLM = "  - name: judge\n    type: llm\n    criteria: 'PASS if x. FAIL if y.'\n";
const QUIET =
  "  - name: quiet\n    type: tool_used\n    tool: Skill\n    min: 0\n    max: 0\n    arm: both\n";

/** Write one case and parse it back through the real parser. */
const load = (graders: string, opts: { header?: string; tags?: string; prompt?: string } = {}): EvalCase => {
  const dir = join(root, "evals", "c");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "case.yaml"),
    `${opts.header ?? ""}schema_version: "1.1"\nname: c\n${opts.tags ?? ""}execution:\n  prompt: ${opts.prompt ?? "find the file"}\ngraders:\n${graders}`,
  );
  const c = readSuite(root).cases[0];
  if (c === undefined) throw new Error("case did not parse");
  return c;
};

describe("assess", () => {
  it("can-fail: a regex fails the bad reply", () => {
    expect(assess(load(REGEX("main\\.ts")), "no idea").state).toBe("can-fail");
  });
  it("cannot-fail: the bad reply passes every grader in the case", () => {
    const a = assess(load(REGEX("Done")), "Done, but wrong");
    expect(a.state).toBe("cannot-fail");
    expect(a.reason).toContain("bad reply passes every grader");
  });
  it("unproven, not cannot-fail: the bad reply passes the regex but an llm grader is unrun", () => {
    expect(assess(load(REGEX("Done") + LLM), "Done, but wrong").state).toBe("unproven");
  });
  it("unproven: no bad reply, blank bad reply, or no runnable regex", () => {
    expect(assess(load(REGEX("main"))).state).toBe("unproven");
    expect(assess(load(REGEX("main")), "  \n").state).toBe("unproven");
    expect(assess(load(LLM), "anything").state).toBe("unproven");
  });
  it("cannot-fail by shape: only quiet Skill checks, needs no bad reply", () => {
    expect(assess(load(QUIET)).state).toBe("cannot-fail");
  });
  it("cannot-fail by shape: a contains regex that matches the prompt", () => {
    expect(assess(load(REGEX("find"))).state).toBe("cannot-fail");
  });
  it("a not_contains regex that matches the prompt is not cued", () => {
    expect(assess(load(REGEX("find", "    match: not_contains\n"))).state).toBe("unproven");
  });
  it("unproven, not a crash, when a pattern does not compile", () => {
    expect(assess(load(REGEX("(unclosed")), "reply").state).toBe("unproven");
  });
  it("reports the exempt label without hiding the state", () => {
    expect(assess(load(QUIET, { tags: "tags: [smoke]\n" }))).toMatchObject({ state: "cannot-fail", exempt: "smoke" });
    expect(assess(load(QUIET, { tags: "tags: [probe]\n" }))).toMatchObject({ state: "cannot-fail", exempt: "probe" });
    expect(assess(load(QUIET, { tags: "tags: [trigger-boundary]\n" }))).toMatchObject({
      state: "cannot-fail",
      exempt: "trigger-boundary",
    });
    expect(assess(load(QUIET)).exempt).toBeUndefined();
  });
});

describe("regexPasses and probeCase", () => {
  const grader = (pattern: string, extra = ""): RegexGrader => {
    const g = load(REGEX(pattern, extra)).graders[0];
    if (g?.type !== "regex") throw new Error("not a regex grader");
    return g;
  };
  it("handles contains, not_contains and count:N", () => {
    expect(regexPasses(grader("a"), "cat")).toBe(true);
    expect(regexPasses(grader("a", "    match: not_contains\n"), "cat")).toBe(false);
    expect(regexPasses(grader("a", "    match: 'count:2'\n"), "banana")).toBe(false);
    expect(regexPasses(grader("a", "    match: 'count:3'\n"), "banana")).toBe(true);
  });
  it("returns undefined for a pattern that does not compile", () => {
    expect(regexPasses(grader("(unclosed"), "x")).toBeUndefined();
  });
  it("labels each grader pass, FAIL, unproven or not-run", () => {
    const c = load(REGEX("hi") + LLM);
    expect(probeCase(c, "hi")).toEqual(["pass g", "not-run judge (llm)"]);
    expect(probeCase(c, "yo")).toEqual(["FAIL g", "not-run judge (llm)"]);
    expect(probeCase(load(REGEX("(unclosed")), "x")).toEqual(["unproven g"]);
  });
});

describe("loadBadReply", () => {
  it("reads the header, and is undefined when absent or blank", () => {
    expect(loadBadReply(load(REGEX("x"), { header: "# bad-reply: nope\n" }))).toBe("nope");
    expect(loadBadReply(load(REGEX("x")))).toBeUndefined();
    expect(loadBadReply(load(REGEX("x"), { header: "# bad-reply:\n" }))).toBeUndefined();
  });
});

describe("atCeiling", () => {
  const s = (w: number, wo: number, tags: string[] = []) => ({ with: w, without: wo, tags });
  it("is flat only when both arms reach the shared CEILING", () => {
    expect(CEILING).toBe(0.95);
    expect(atCeiling(s(0.95, 0.95)).flat).toBe(true);
    expect(atCeiling(s(1, 0.94)).flat).toBe(false);
    expect(atCeiling(s(0.94, 1)).flat).toBe(false);
  });
  it("names the label that holds it: probe first, then smoke", () => {
    expect(atCeiling(s(1, 1, ["smoke"])).held).toBe("smoke");
    expect(atCeiling(s(1, 1, ["smoke", "probe"])).held).toBe("probe");
    expect(atCeiling(s(1, 1)).held).toBeUndefined();
  });
  it("flaggedBefore is true unless the free check showed can-fail", () => {
    const flag = (state: "can-fail" | "cannot-fail" | "unproven") =>
      atCeiling(s(1, 1), { state, reason: "" }).flaggedBefore;
    expect(flag("unproven")).toBe(true);
    expect(flag("cannot-fail")).toBe(true);
    expect(flag("can-fail")).toBe(false);
    expect(atCeiling(s(1, 1)).flaggedBefore).toBe(false);
  });
});
