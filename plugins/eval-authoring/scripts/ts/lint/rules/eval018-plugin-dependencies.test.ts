/** Pins each EVAL018 check separately; the fixture harness only needs one finding per bad fixture. */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../runner.ts";
import { rule } from "./eval018-plugin-dependencies.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL018");

const findings = (fixture: string) => {
  const outcome = lintPlugin(join(FIXTURES, fixture), [rule], { evalDir: "cases" });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.filter((f) => f.ruleId === "EVAL018");
};

describe.each(["case-yaml", "prompt-md"])("EVAL018 (%s layout)", (layout) => {
  it("reports an unmet dependency as an error that cites #450, not the docs", () => {
    const found = findings(`bad-unmet-dependency-${layout}`);
    expect(found).toHaveLength(1);
    expect(found[0]?.severity).toBe("error");
    expect(found[0]?.message).toMatch(/declares dependency 'helper'/);
    expect(found[0]?.message).toMatch(/\(#450\), not the plugin-evals docs/);
    expect(found[0]?.source).toMatch(/\(#450\), not the plugin-evals docs/);
  });

  it("reports a dependency when the case has no plugins field", () => {
    const found = findings(`bad-no-plugins-field-${layout}`);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/dependency 'helper@some-marketplace'/);
  });

  it("reports a plugins entry outside the plugin, and says the check is lexical", () => {
    const found = findings(`bad-outside-root-${layout}`);
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toMatch(/'..\/..\/..\/sibling-plugin'.*outside the plugin under test/);
    expect(found[0]?.message).toMatch(/lexical/);
    expect(found[0]?.message).toMatch(/#450/);
  });

  it.each(["good-vendored", "good-object-dependency", "good-no-dependencies"])(
    "is quiet for %s",
    (name) => {
      expect(findings(`${name}-${layout}`)).toEqual([]);
    },
  );
});
