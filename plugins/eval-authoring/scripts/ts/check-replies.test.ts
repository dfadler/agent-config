import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSuite } from "./parser/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPlugin, exitCode, headerReplies, probeCase } from "./check-replies.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-replies-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const addCase = (name: string, header: string, graders: string): void => {
  const dir = join(root, "evals", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "case.yaml"),
    `${header}schema_version: "1.1"\nname: ${name}\nexecution:\n  prompt: hi\ngraders:\n${graders}`,
  );
};
const REGEX = "  - name: says_hi\n    type: regex\n    pattern: 'hi'\n";
const LLM = "  - name: judge\n    type: llm\n    criteria: 'PASS if x. FAIL if y.'\n";

describe("headerReplies", () => {
  it("reads one-line and continued replies", () => {
    expect(headerReplies("# good-reply: hi there\n# bad-reply:\n#   line1\n#   line2\nschema_version: x\n")).toEqual({
      good: "hi there",
      bad: "line1\nline2",
    });
  });
});

describe("checkPlugin", () => {
  it("passes when good passes and bad fails the regex", () => {
    addCase("ok", "# good-reply: hi\n# bad-reply: nope\n", REGEX + LLM);
    expect(checkPlugin(root)[0]?.status).toBe("ok");
  });
  it("fails when no regex grader fails the bad reply", () => {
    addCase("weak", "# good-reply: hi\n# bad-reply: hi again\n", REGEX);
    const r = checkPlugin(root);
    expect(r[0]?.status).toBe("fail");
    expect(exitCode(r, false)).toBe(1);
  });
  it("fails when the good reply misses a regex", () => {
    addCase("g", "# good-reply: nope\n# bad-reply: nope\n", REGEX);
    expect(checkPlugin(root)[0]?.detail).toContain("good-reply fails: says_hi");
  });
  it("reports llm-only cases as unchecked and header-less llm cases as missing", () => {
    addCase("a", "# good-reply: x\n# bad-reply: y\n", LLM);
    addCase("b", "", LLM);
    const r = checkPlugin(root);
    expect(r.map((x) => x.status)).toEqual(["unchecked", "missing"]);
    expect(exitCode(r, false)).toBe(0);
    expect(exitCode(r, true)).toBe(1);
  });
  it("reports a regex-only case without header replies as missing", () => {
    addCase("r", "", REGEX);
    const r = checkPlugin(root);
    expect(r[0]?.status).toBe("missing");
    expect(exitCode(r, true)).toBe(1);
  });
  it("throws when the plugin has no cases", () => {
    expect(() => checkPlugin(root)).toThrow(/no eval cases/);
  });
  it("reads the header of a prompt.md case", () => {
    const dir = join(root, "evals", "pm");
    mkdirSync(join(dir, "graders"), { recursive: true });
    writeFileSync(join(dir, "prompt.md"), "---\n# good-reply: hi\n# bad-reply: nope\nname: pm\n---\nhi\n");
    writeFileSync(join(dir, "graders", "g.md"), "---\nname: says_hi\ntype: regex\npattern: 'hi'\n---\n");
    const r = checkPlugin(root);
    expect(r[0]?.status).toBe("ok");
  });
});

describe("probeCase", () => {
  it("reports pass or FAIL per last_message regex and not-run for the rest", () => {
    addCase("p", "", REGEX + LLM);
    const c = readSuite(root).cases[0];
    if (c === undefined) throw new Error("no case");
    expect(probeCase(c, "hi")).toEqual(["pass says_hi", "not-run judge (llm)"]);
    expect(probeCase(c, "nope")).toEqual(["FAIL says_hi", "not-run judge (llm)"]);
  });
});
