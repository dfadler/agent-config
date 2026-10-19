/** Pins each EVAL014 check separately; the fixture harness only needs one finding per bad fixture. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../runner.ts";
import { rule } from "./eval014-scaffolds.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL014");

const messages = (fixture: string): readonly string[] => {
  const outcome = lintPlugin(join(FIXTURES, fixture), [rule], { evalDir: "cases" });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.map((f) => `${f.severity} ${f.ruleId} ${f.message} ${f.source}`);
};

describe("EVAL014", () => {
  it("reports a missing scaffold_script, naming the file", () => {
    const found = messages("bad-missing-scaffold");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/warn EVAL014 .*scaffold_script to 'scaffold-script'/);
  });

  it.each(["bad-bin-case-yaml", "bad-bin-prompt-md", "bad-bin-suite"])(
    "reports fixtures/bin as speculative in %s",
    (fixture) => {
      const found = messages(fixture);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/fixtures\/bin directory\. This check is speculative/);
      expect(found[0]).toMatch(/#450/);
    },
  );

  it("does not report an existing script or an ordinary fixtures directory", () => {
    expect(messages("good-case-yaml")).toEqual([]);
    expect(messages("good-prompt-md")).toEqual([]);
  });
});

describe("EVAL014 leakage (#744)", () => {
  it("reports git history made by a scaffold_script", () => {
    const found = messages("bad-git-history");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/commits, branches or tags in git/);
  });

  it("reports an answer file in add_dirs", () => {
    const found = messages("bad-add-dirs-answer");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/add_dirs entry 'data' contains answer\.md/);
  });

  it("does not report a clean add_dirs or a git init-only scaffold", () => {
    expect(messages("good-add-dirs-clean")).toEqual([]);
    expect(messages("good-case-yaml")).toEqual([]);
  });
});
