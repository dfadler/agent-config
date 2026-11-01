/** Pins each EVAL028 branch separately; the fixture harness only proves which cases fire. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRules } from "../discover.ts";
import { lintPlugin } from "../runner.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL028");
const found = await discoverRules();
const rules = found.ok ? found.rules : [];

const lint = (fixture: string) => {
  const outcome = lintPlugin(join(FIXTURES, fixture), rules, { evalDir: "cases" });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings;
};
const messageFor = (fixture: string, caseDir: string): string =>
  lint(fixture)
    .filter((f) => f.ruleId === "EVAL028" && f.caseDirName === caseDir)
    .map((f) => f.message)
    .join("\n");

describe("EVAL028", () => {
  it.each([
    ["no-pair", /has no pair:<case> tag/],
    ["ghost-pair", /names pair 'ghost', which is not a case in this suite/],
    ["wrong-twin", /no named must-fire check .* same tool/],
    ["two-arm", /sets `arm: both`/],
    ["unnamed", /has no name; run-evals reads the fire count by grader name/],
    ["no-matcher", /no named must-fire check .* present, equal input_match/],
    ["unnamed-twin-grader", /no named must-fire check/],
    ["no-quiet-check", /has no must-not-fire check/],
  ])("explains %s", (caseDir, message) => {
    expect(messageFor("bad-case-yaml", caseDir)).toMatch(message);
  });

  it("is quiet for the twin, the other twin and a plain smoke guard", () => {
    const twins = ["twin", "other-twin", "matcherless-twin", "unnamed-twin"];
    expect(lint("bad-case-yaml").filter((f) => f.ruleId === "EVAL028" && twins.includes(f.caseDirName ?? ""))).toEqual([]);
    expect(lint("good-case-yaml").filter((f) => f.ruleId === "EVAL028")).toEqual([]);
  });

  it("keeps the two-arm rules quiet about a single-arm boundary negative", () => {
    const noise = lint("good-case-yaml").filter(
      (f) => ["EVAL007", "EVAL008", "EVAL025"].includes(f.ruleId) && f.caseDirName?.startsWith("neg-") === true,
    );
    expect(noise).toEqual([]);
  });

  it("leaves a boundary case with a stray `arm: both` to EVAL028, not EVAL025", () => {
    const twoArm = lint("bad-case-yaml").filter((f) => f.caseDirName === "two-arm").map((f) => f.ruleId);
    expect(twoArm).toContain("EVAL028");
    expect(twoArm).not.toContain("EVAL025");
  });
});
