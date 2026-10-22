import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkPlugin, exitCode, headerReplies } from "./check-replies.ts";

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
});
