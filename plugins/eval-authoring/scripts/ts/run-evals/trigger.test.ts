import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSuite } from "../parser/index.ts";
import { nodeIo } from "./io.ts";
import { renderSummary } from "./summary.ts";
import { armTally, routablesOf, triggerGraders, triggerRows } from "./trigger.ts";

const write = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

const grader = (name: string, skill: string, bounds: string): string =>
  [
    `  - name: ${name}`,
    "    type: tool_used",
    "    tool: Skill",
    `    input_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?${skill}"'`,
    `    ${bounds}`,
  ].join("\n");

const caseYaml = (name: string, graders: readonly string[]): string =>
  [
    'schema_version: "1.1"',
    `name: ${name}`,
    "tags: [trigger]",
    "execution:",
    "  prompt: hello",
    "graders:",
    ...graders,
    "",
  ].join("\n");

/**
 * Plugin with skills alpha (description 5 chars) and beta (quoted, 12 chars).
 * Names are deliberately misleading: the role is in min and max, not the name.
 */
const plugin = () => {
  const root = mkdtempSync(join(tmpdir(), "trigger-test-"));
  write(join(root, ".claude-plugin", "plugin.json"), '{"name":"pl"}');
  write(join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: abcde\n---\nbody\n");
  write(join(root, "skills", "beta", "SKILL.md"), '---\ndescription: "twelve chars"\n---\nbody\n');
  write(join(root, "evals", "a-should", "case.yaml"), caseYaml("a-should", [grader("skill_not_fired", "alpha", "min: 1")]));
  write(join(root, "evals", "a-quiet", "case.yaml"), caseYaml("a-quiet", [grader("skill_fired", "alpha", "max: 0\n    min: 0")]));
  write(join(root, "evals", "b-should", "case.yaml"), caseYaml("b-should", [grader("zzz", "beta", "min: 1")]));
  write(join(root, "evals", "other", "case.yaml"), caseYaml("other", [grader("unrelated", "gamma", "min: 1")]));
  return root;
};

const run = (...graders: readonly (readonly [string, boolean])[]): unknown => ({
  graders: graders.map(([name, passed]) => ({ name, passed })),
});
const result = (caseName: string, runs: readonly unknown[]): string =>
  JSON.stringify({ cases: [{ name: caseName, arms: { with: runs, without: [run(["x", false])] } }] });

describe("routablesOf", () => {
  it("reads each skill's name and description length, falling back to the directory name", () => {
    const root = plugin();
    expect(routablesOf(nodeIo(process.env), root)).toEqual([
      { name: "alpha", descriptionChars: 5 },
      { name: "beta", descriptionChars: 12 },
    ]);
  });
});

describe("triggerGraders", () => {
  it("classifies by min and max and ignores the grader's name; drops graders about no known skill", () => {
    const root = plugin();
    const suite = readSuite(root, {});
    const routables = routablesOf(nodeIo(process.env), root);
    const of = (n: string) =>
      suite.cases.flatMap((c) => (c.name.value === n ? triggerGraders(c, routables, "pl") : []));
    expect(of("a-should")).toEqual([{ grader: "skill_not_fired", role: "fires", names: ["alpha"] }]);
    expect(of("a-quiet")).toEqual([{ grader: "skill_fired", role: "must-not-fire", names: ["alpha"] }]);
    expect(of("b-should")).toEqual([{ grader: "zzz", role: "fires", names: ["beta"] }]);
    expect(of("other")).toEqual([]);
  });
});

describe("armTally", () => {
  it("counts the plugin arm's runs that carry the grader, and those that passed", () => {
    const text = result("c", [run(["g", true]), run(["g", false]), run(["h", true]), run(["g", true])]);
    expect(armTally(text, "c", "g")).toEqual({ runs: 3, passed: 2 });
    expect(armTally(text, "c", "missing")).toEqual({ runs: 0, passed: 0 });
    expect(armTally(text, "nope", "g")).toEqual({ runs: 0, passed: 0 });
    expect(armTally(undefined, "c", "g")).toEqual({ runs: 0, passed: 0 });
  });
});

describe("triggerRows", () => {
  it("gives a fire rate from the fires cases and a false-fire rate from the must-not-fire cases, per skill", () => {
    const root = plugin();
    const suite = readSuite(root, {});
    const rows = triggerRows(suite, routablesOf(nodeIo(process.env), root), "pl", [
      // alpha should fire: 2 of 3 runs did.
      { caseName: "a-should", text: result("a-should", [run(["skill_not_fired", true]), run(["skill_not_fired", true]), run(["skill_not_fired", false])]) },
      // alpha must stay quiet: 1 of 4 runs fired anyway (its grader failed).
      { caseName: "a-quiet", text: result("a-quiet", [run(["skill_fired", true]), run(["skill_fired", true]), run(["skill_fired", false]), run(["skill_fired", true])]) },
      { caseName: "b-should", text: result("b-should", [run(["zzz", true])]) },
      // Not run, not tabulated.
    ]);
    expect(rows).toEqual([
      { skill: "alpha", fires: { hit: 2, runs: 3 }, falseFires: { hit: 1, runs: 4 }, descriptionChars: "5" },
      { skill: "beta", fires: { hit: 1, runs: 1 }, falseFires: undefined, descriptionChars: "12" },
    ]);
  });
});

describe("renderSummary trigger section", () => {
  const base = {
    plugin: "pl",
    tier: "standard",
    model: "m",
    judgeModel: "j",
    spentUsd: 0.1,
    ceilingUsd: 5,
    exit: 0,
    command: "run",
    unstarted: [],
    cases: [],
  };
  const rows = [
    { skill: "alpha", fires: { hit: 2, runs: 3 }, falseFires: { hit: 1, runs: 4 }, descriptionChars: "5" },
    { skill: "beta", fires: undefined, falseFires: { hit: 0, runs: 0 }, descriptionChars: "-" },
  ];

  it("names the neighbours and shows both rates and the description length", () => {
    const out = renderSummary({ ...base, neighbours: ["sib", "other"], trigger: rows });
    expect(out).toContain("### Trigger set");
    expect(out).toContain("Neighbours loaded beside `pl`");
    expect(out).toContain("`sib`, `other`");
    expect(out).toContain("| alpha | 2/3 (0.67) | 1/4 (0.25) | 5 |");
    expect(out).toContain("| beta | - | - | - |");
  });
  it("shows the table without a neighbours line when the flag was off, and nothing when there is no row", () => {
    const plain = renderSummary({ ...base, trigger: rows });
    expect(plain).toContain("| alpha | 2/3 (0.67) | 1/4 (0.25) | 5 |");
    expect(plain).not.toContain("Neighbours loaded");
    expect(renderSummary({ ...base, trigger: [] })).not.toContain("Trigger set");
    expect(renderSummary(base)).not.toContain("Trigger set");
  });
  it("says so when neighbours were loaded but no grader could be tabulated", () => {
    expect(renderSummary({ ...base, neighbours: ["sib"], trigger: [] })).toContain("nothing to tabulate");
  });
});
