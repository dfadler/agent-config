import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGrantsFile, readSuite } from "../parser/index.ts";
import { needsBash, planGroups } from "./plan.ts";
import { makePlugin } from "./test-support.ts";

const plan = (
  cases: Parameters<typeof makePlugin>[0],
  grants: string | undefined,
  tag?: string,
) => {
  const root = makePlugin(cases, grants);
  const suite = readSuite(root);
  return planGroups(suite, readGrantsFile(join(suite.evalDir, "grants.yaml")), tag);
};

const grantsYaml = (body: string): string =>
  `schema_version: "1"\ngrants:\n${body}`;

describe("planGroups", () => {
  it("makes one group per distinct grant set, never a union", () => {
    const p = plan(
      [{ name: "a" }, { name: "b" }, { name: "c" }],
      grantsYaml(
        '  a:\n    - "Bash(npx *)"\n  b:\n    - "Bash(npx --yes x *)"\n',
      ),
    );
    expect(p).toEqual({
      ok: true,
      groups: [
        { grants: ["Bash(npx *)"], cases: ["a"] },
        { grants: ["Bash(npx --yes x *)"], cases: ["b"] },
        { grants: [], cases: ["c"] },
      ],
    });
  });

  it("shares a run between cases with identical grants, whatever the entry order", () => {
    const p = plan(
      [{ name: "a" }, { name: "b" }],
      grantsYaml(
        '  a:\n    - "Write"\n    - "Bash"\n  b:\n    - "Bash"\n    - "Write"\n',
      ),
    );
    expect(p).toEqual({
      ok: true,
      groups: [{ grants: ["Bash", "Write"], cases: ["a", "b"] }],
    });
  });

  it("treats a missing grants file as no grants", () => {
    expect(plan([{ name: "a" }, { name: "b" }], undefined)).toEqual({
      ok: true,
      groups: [{ grants: [], cases: ["a", "b"] }],
    });
  });

  it("keeps only cases with the tag", () => {
    const p = plan(
      [{ name: "a", tags: ["quick"] }, { name: "b" }],
      undefined,
      "quick",
    );
    expect(p).toEqual({
      ok: true,
      groups: [{ grants: [], cases: ["a"] }],
    });
  });

  it("fails when no case carries the tag", () => {
    const p = plan([{ name: "a" }], undefined, "quick");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("no cases tagged 'quick'");
  });

  it("fails when there are no cases", () => {
    expect(plan([], undefined).ok).toBe(false);
  });

  it("fails on a grants entry for a case that does not exist", () => {
    const p = plan([{ name: "a" }], grantsYaml('  ghost:\n    - "Bash"\n'));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain("ghost");
  });

  it("fails on an invalid grant entry", () => {
    const p = plan([{ name: "a" }], grantsYaml('  a:\n    - "Read"\n'));
    expect(p.ok).toBe(false);
  });
});

describe("needsBash", () => {
  it("is true only when a group is granted Bash", () => {
    expect(needsBash([{ grants: ["Bash(npx *)"], cases: ["a"] }])).toBe(true);
    expect(needsBash([{ grants: ["Bash"], cases: ["a"] }])).toBe(true);
    expect(needsBash([{ grants: ["Write"], cases: ["a"] }])).toBe(false);
    expect(needsBash([{ grants: [], cases: ["a"] }])).toBe(false);
  });
});
