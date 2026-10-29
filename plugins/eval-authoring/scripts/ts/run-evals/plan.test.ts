import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGrantsFile, readSuite } from "../parser/index.ts";
import { spawnProcess, type Io } from "./io.ts";
import { changedCases, needsBash, planGroups, selectChanged } from "./plan.ts";
import { fakeIo, makePlugin } from "./test-support.ts";

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

describe("changedCases", () => {
  const suiteOf = (root: string) => readSuite(root);

  it("maps a case file, a skill, an agent and a manifest to cases", () => {
    const root = makePlugin([
      { name: "a", tags: ["x"] },
      { name: "b", tags: ["y"] },
      { name: "c" },
    ]);
    const suite = suiteOf(root);
    expect(changedCases(suite, root, ["evals/a/case.yaml"])).toEqual(["a"]);
    expect(changedCases(suite, root, ["skills/y/SKILL.md"])).toEqual(["b"]);
    expect(changedCases(suite, root, ["agents/x.md"])).toEqual(["a"]);
    expect(changedCases(suite, root, ["README.md", "scripts/ts/x.ts"])).toEqual([]);
    expect(changedCases(suite, root, ["evals/grants.yaml"])).toEqual(["a", "b", "c"]);
    expect(changedCases(suite, root, [".claude-plugin/plugin.json"])).toEqual(["a", "b", "c"]);
  });

  it("selects a case whose tool_used grader names the skill, without a tag", () => {
    const root = makePlugin([{ name: "a" }]);
    writeFileSync(
      join(root, "evals", "a", "case.yaml"),
      [
        'schema_version: "1.1"',
        "name: a",
        "tags: []",
        "execution:",
        "  prompt: hello",
        "graders:",
        "  - name: fired",
        "    type: tool_used",
        "    tool: Skill",
        "    input_match: '\"skill\"\\s*:\\s*\"(?:[\\w-]+:)?x\"'",
        "",
      ].join("\n"),
    );
    expect(changedCases(suiteOf(root), root, ["skills/x/SKILL.md"])).toEqual(["a"]);
    expect(changedCases(suiteOf(root), root, ["skills/y/SKILL.md"])).toEqual([]);
  });
});

describe("selectChanged", () => {
  const git = (root: string, ...args: string[]) =>
    spawnProcess("git", [
      "-C",
      root,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ]);
  const io = (): Io => ({ ...fakeIo().io, spawn: spawnProcess });

  /** A committed plugin repo with cases a (skill x), b (skill y) and a `base` branch at the commit. */
  const repo = async (): Promise<string> => {
    const root = makePlugin([
      { name: "a", tags: ["x"] },
      { name: "b", tags: ["y"] },
    ]);
    mkdirSync(join(root, "skills", "x"), { recursive: true });
    mkdirSync(join(root, "skills", "y"), { recursive: true });
    writeFileSync(join(root, "skills", "x", "SKILL.md"), "x\n");
    writeFileSync(join(root, "skills", "y", "SKILL.md"), "y\n");
    for (const args of [["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"], ["branch", "base"]]) {
      const r = await git(root, ...args);
      expect(r.status, r.stderr).toBe(0);
    }
    return root;
  };

  it("selects nothing when nothing changed", async () => {
    const root = await repo();
    await expect(selectChanged(io(), root, readSuite(root), "base")).resolves.toEqual({
      ok: true,
      ref: "base",
      names: [],
    });
  });

  it("selects an uncommitted case edit", async () => {
    const root = await repo();
    appendFileSync(join(root, "evals", "a", "case.yaml"), "# edited\n");
    const r = await selectChanged(io(), root, readSuite(root), "base");
    expect(r).toEqual({ ok: true, ref: "base", names: ["a"] });
  });

  it("selects the cases of a committed skill change plus an untracked new case", async () => {
    const root = await repo();
    appendFileSync(join(root, "skills", "y", "SKILL.md"), "more\n");
    expect((await git(root, "commit", "-q", "-am", "skill")).status).toBe(0);
    mkdirSync(join(root, "evals", "d"));
    writeFileSync(
      join(root, "evals", "d", "case.yaml"),
      readFileSync(join(root, "evals", "b", "case.yaml"), "utf8").replace("name: b", "name: d"),
    );
    const r = await selectChanged(io(), root, readSuite(root), "base");
    expect(r).toEqual({ ok: true, ref: "base", names: ["b", "d"] });
  });

  it("fails on a ref with no merge base", async () => {
    const root = await repo();
    const r = await selectChanged(io(), root, readSuite(root), "no-such-ref");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no-such-ref");
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
