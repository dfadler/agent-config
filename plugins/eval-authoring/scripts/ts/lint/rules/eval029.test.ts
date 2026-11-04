/** Pins EVAL029's role boundary; the fixture harness only proves which cases fire. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRules } from "../discover.ts";
import { lintPlugin } from "../runner.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL029");
const found = await discoverRules();
const rules = found.ok ? found.rules : [];

const hits = (fixture: string) => {
  const outcome = lintPlugin(join(FIXTURES, fixture), rules, { evalDir: "cases" });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.filter((f) => f.ruleId === "EVAL029");
};

describe("EVAL029", () => {
  it("flags a Skill check with min 0 and no max, or min 0 and max 2, whatever its name", () => {
    const found = hits("bad-no-role");
    expect(found.map((f) => f.caseDirName).sort()).toEqual(["capped", "unbounded"]);
    expect(found.map((f) => f.message).join("\n")).toMatch(/min 0 and max unset/);
    expect(found.map((f) => f.message).join("\n")).toMatch(/min 0 and max 2/);
  });

  it("is quiet for a fires check, a must-not-fire check and a min: 1 outcome check on another tool", () => {
    expect(hits("good-roles")).toEqual([]);
  });
});
