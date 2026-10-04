/**
 * The fixture harness only asserts that a bad fixture fires at least once, so
 * this pins each EVAL013 check separately: breaking one check fails here.
 */
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../runner.ts";
import { rule } from "./eval013-mocks.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL013");

const messages = (fixture: string): readonly string[] => {
  const outcome = lintPlugin(join(FIXTURES, fixture), [rule]);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.map((f) => `${f.ruleId} ${f.message}`);
};

describe.each(["bad-case-yaml", "bad-prompt-md", "bad-suite"])("EVAL013 %s", (fixture) => {
  const found = messages(fixture);
  it.each([
    ["a server outside the MCP config", /ghost\/ping is for server 'ghost'/],
    ["an invalid regex in expect", /expect\.priority. is not a valid regex/],
    ["a type word used as a literal", /expect\.kind. is .integer./],
    ["type: agent with no recording", /triage is .type: agent. with no recording/],
  ])("reports %s", (_what, pattern) => {
    expect(found.some((m) => pattern.test(m))).toBe(true);
  });
});

describe("EVAL013 with a relative plugin root", () => {
  /** Same lint, but the plugin root is a path relative to the working directory. */
  const relativeMessages = (fixture: string): readonly string[] => {
    const outcome = lintPlugin(relative(process.cwd(), join(FIXTURES, fixture)), [rule]);
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.report.findings.map((f) => `${f.ruleId} ${f.message}`);
  };

  it.each(["bad-suite", "bad-case-yaml", "bad-prompt-md"])(
    "finds the same mock problems in %s as with an absolute root",
    (fixture) => {
      expect(relativeMessages(fixture)).toEqual(messages(fixture));
      expect(relativeMessages(fixture).length).toBeGreaterThan(0);
    },
  );

  it("stays quiet on a good fixture", () => {
    expect(relativeMessages("good-case-yaml")).toEqual([]);
  });
});

describe("EVAL013 other bad fixtures", () => {
  it("rejects a type other than fixed and agent", () => {
    expect(messages("bad-case-yaml").some((m) => /type 'script'/.test(m))).toBe(true);
  });
  it("reports a mock when the plugin has no MCP config at all", () => {
    expect(messages("bad-no-mcp-config").some((m) => /none found/.test(m))).toBe(true);
  });
  it("reports suite mocks once, not once per case", () => {
    expect(messages("bad-suite").filter((m) => /ghost\/ping/.test(m))).toHaveLength(1);
  });
});
