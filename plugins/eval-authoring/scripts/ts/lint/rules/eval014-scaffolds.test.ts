/** Pins each EVAL014 check separately; the fixture harness only needs one finding per bad fixture. */
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { lintPlugin } from "../runner.ts";
import { rule } from "./eval014-scaffolds.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "..", "tests", "lint-fixtures", "EVAL014");

const messages = (fixture: string): readonly string[] => {
  const outcome = lintPlugin(isAbsolute(fixture) ? fixture : join(FIXTURES, fixture),[rule], { evalDir: "cases" });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.report.findings.map((f) => `${f.severity} ${f.ruleId} ${f.message} ${f.source}`);
};

describe("EVAL014", () => {
  it("reports a missing scaffold_script, naming the file", () => {
    const found = messages("bad-missing-scaffold");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/warn EVAL014 .*scaffold_script to 'scaffold-script'/);
  });

  it("does not report an existing script or a fixtures/bin directory", () => {
    expect(messages("good-case-yaml")).toEqual([]);
    expect(messages("good-prompt-md")).toEqual([]);
    expect(messages("good-bin-ignored")).toEqual([]);
  });
});

describe("EVAL014 leakage (#744)", () => {
  it("reports git history made by a scaffold_script", () => {
    const found = messages("bad-git-history");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/commits, branches or tags in git/);
  });

  it("reports git -C and git -c before the verb, as info", () => {
    const found = messages("bad-git-flags");
    expect(found).toHaveLength(2);
    for (const f of found) expect(f).toMatch(/^info EVAL014 .*commits, branches or tags in git/);
  });

  it("reports a bare .git in add_dirs as info, an answer file as warn", () => {
    const dir = mkdtempSync(join(tmpdir(), "eval014-"));
    try {
      cpSync(join(FIXTURES, "good-add-dirs-clean"), dir, { recursive: true });
      mkdirSync(join(dir, "cases", "ok", "data", ".git"));
      const found = messages(dir);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatch(/^info EVAL014 .*contains \.git/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(messages("bad-add-dirs-answer")[0]).toMatch(/^warn /);
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
