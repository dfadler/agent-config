import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readGrantsFile, readSuite } from "../parser/index.ts";
import { spawnProcess, type Io } from "./io.ts";
import {
  changedCases,
  DEFAULT_CHANGED_REF,
  needsBash,
  planGroups,
  selectChanged,
  TRIGGER_TAG,
  type ChangedContext,
} from "./plan.ts";
import { fakeIo, makePlugin, spawned } from "./test-support.ts";

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
  const noGrants = readGrantsFile("/nonexistent/grants.yaml");
  const names = (
    root: string,
    paths: readonly string[],
    ctx: Partial<ChangedContext> = {},
  ): readonly string[] =>
    changedCases(suiteOf(root), root, paths, { grants: noGrants, routingChanged: [], ...ctx }).names;

  it("maps a case file, a skill, an agent and a manifest to cases", () => {
    const root = makePlugin([
      { name: "a", tags: ["x"] },
      { name: "b", tags: ["y"] },
      { name: "c" },
    ]);
    expect(names(root, ["evals/a/case.yaml"])).toEqual(["a"]);
    expect(names(root, ["skills/y/SKILL.md"])).toEqual(["b"]);
    expect(names(root, ["agents/x.md"])).toEqual(["a"]);
    expect(names(root, ["README.md", "docs/x.md", "scripts/ts/x.ts"])).toEqual([]);
    expect(names(root, ["evals/grants.yaml"])).toEqual(["a", "b", "c"]);
    expect(names(root, [".claude-plugin/plugin.json"])).toEqual(["a", "b", "c"]);
  });

  it("lists the paths that select nothing", () => {
    const root = makePlugin([{ name: "a", tags: ["x"] }]);
    const r = changedCases(
      suiteOf(root),
      root,
      ["README.md", "skills/x/SKILL.md", "docs/guide.md"],
      { grants: noGrants, routingChanged: [] },
    );
    expect(r).toEqual({ names: ["a"], unmapped: ["README.md", "docs/guide.md"] });
  });

  it("maps scripts/** to the cases granted Bash, and to every case when a hook references the script", () => {
    const root = makePlugin(
      [{ name: "a" }, { name: "b" }, { name: "c" }],
      grantsYaml("  a:\n    - \"Bash(node *)\"\n  b:\n    - \"Write\"\n"),
    );
    const grants = readGrantsFile(join(root, "evals", "grants.yaml"));
    expect(names(root, ["scripts/ts/x.ts"], { grants })).toEqual(["a"]);
    mkdirSync(join(root, "hooks", "scripts"), { recursive: true });
    writeFileSync(join(root, "hooks", "scripts", "h.sh"), 'node "$here/../../scripts/ts/hook/h.ts"\n');
    expect(names(root, ["scripts/ts/hook/h.ts"], { grants })).toEqual(["a", "b", "c"]);
    expect(names(root, ["scripts/ts/x.ts"], { grants })).toEqual(["a"]);
  });

  it("counts a case whose allowed_tools grants Bash, with no grants entry, as a Bash case", () => {
    const root = makePlugin([{ name: "a" }, { name: "b" }]);
    writeFileSync(
      join(root, "evals", "a", "case.yaml"),
      readFileSync(join(root, "evals", "a", "case.yaml"), "utf8").replace(
        "execution:\n",
        "execution:\n  allowed_tools: [Read, Bash(node *)]\n",
      ),
    );
    expect(names(root, ["scripts/ts/x.ts"])).toEqual(["a"]);
  });

  it("reads hooks declared inline in the manifest and skips a symlinked hooks directory", () => {
    const root = makePlugin([{ name: "a" }, { name: "b" }]);
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "p",
        hooks: { PreToolUse: [{ hooks: [{ command: "node ${CLAUDE_PLUGIN_ROOT}/scripts/ts/hook/h.ts" }] }] },
      }),
    );
    // A symlinked directory under hooks/ is not followed, even one that names the script.
    mkdirSync(join(root, "hooks"));
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "h.sh"), "node scripts/ts/x.ts\n");
    symlinkSync(join(root, "elsewhere"), join(root, "hooks", "link"));
    symlinkSync(root, join(root, "hooks", "loop"));
    expect(names(root, ["scripts/ts/hook/h.ts"])).toEqual(["a", "b"]);
    expect(names(root, ["scripts/ts/x.ts"])).toEqual([]);
  });

  it("selects every trigger-tagged case when a skill's or agent's routing changed, else only its own", () => {
    const root = makePlugin([
      { name: "a", tags: ["x"] },
      { name: "b", tags: ["y", TRIGGER_TAG] },
      { name: "c", tags: [TRIGGER_TAG] },
    ]);
    expect(names(root, ["skills/x/SKILL.md"])).toEqual(["a"]);
    expect(names(root, ["skills/x/SKILL.md"], { routingChanged: ["skills/x/SKILL.md"] })).toEqual(["a", "b", "c"]);
    expect(names(root, ["skills/x/reference.md"], { routingChanged: ["skills/y/SKILL.md"] })).toEqual(["a"]);
    expect(names(root, ["agents/x.md"])).toEqual(["a"]);
    expect(names(root, ["agents/x.md"], { routingChanged: ["agents/x.md"] })).toEqual(["a", "b", "c"]);
  });

  const withGrader = (root: string, name: string, tool: string, inputMatch: string): void => {
    writeFileSync(
      join(root, "evals", name, "case.yaml"),
      [
        'schema_version: "1.1"',
        `name: ${name}`,
        "tags: []",
        "execution:",
        "  prompt: hello",
        "graders:",
        "  - name: fired",
        "    type: tool_used",
        `    tool: ${tool}`,
        `    input_match: '${inputMatch}'`,
        "",
      ].join("\n"),
    );
  };

  it("selects a case whose tool_used grader accepts a call to the skill or agent, without a tag", () => {
    const root = makePlugin([{ name: "a" }, { name: "b" }]);
    withGrader(root, "a", "Skill", '"skill"\\s*:\\s*"(?:[\\w-]+:)?x"');
    withGrader(root, "b", "Agent", '"subagent_type"\\s*:\\s*"(?:[\\w-]+:)?x-reviewer"');
    expect(names(root, ["skills/x/SKILL.md"])).toEqual(["a"]);
    expect(names(root, ["agents/x-reviewer.md"])).toEqual(["b"]);
    expect(names(root, ["skills/y/SKILL.md"])).toEqual([]);
  });

  it("accepts the plugin-prefixed agent form from the manifest name, else the plugin dir name", () => {
    const root = makePlugin([{ name: "a" }, { name: "b" }]);
    // The documented form (references/agents.md): a required `<plugin>:` prefix, no bare alternative.
    withGrader(root, "a", "Agent", '"subagent_type"\\s*:\\s*"my-plugin:x-reviewer"');
    withGrader(root, "b", "Skill", '"skill"\\s*:\\s*"my-plugin:x"');
    expect(names(root, ["agents/x-reviewer.md", "skills/x/SKILL.md"])).toEqual([]);
    mkdirSync(join(root, ".claude-plugin"));
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), '{"name": "my-plugin"}');
    expect(names(root, ["agents/x-reviewer.md"])).toEqual(["a"]);
    expect(names(root, ["skills/x/SKILL.md"])).toEqual(["b"]);
    const bare = makePlugin([{ name: "a" }]);
    withGrader(bare, "a", "Agent", `"subagent_type"\\s*:\\s*"${basename(bare)}:x-reviewer"`);
    expect(names(bare, ["agents/x-reviewer.md"])).toEqual(["a"]);
  });

  it("does not select on a substring: the pattern must accept the call payload", () => {
    const root = makePlugin([{ name: "a" }, { name: "b" }]);
    // Names "x-extended", so a call to "x" is not accepted though "x" is a substring of the pattern.
    withGrader(root, "a", "Skill", '"skill"\\s*:\\s*"x-extended"');
    withGrader(root, "b", "Skill", "[unclosed");
    expect(names(root, ["skills/x/SKILL.md"])).toEqual([]);
    expect(names(root, ["skills/x-extended/SKILL.md"])).toEqual(["a"]);
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
  const io = (): Io => ({ ...fakeIo().io, spawn: spawnProcess, realpath: realpathSync });
  const noGrants = readGrantsFile("/nonexistent/grants.yaml");
  const select = (root: string, ref = "base") =>
    selectChanged(io(), root, readSuite(root), noGrants, ref);

  const SKILL_X = "---\nname: x\ndescription: does x\n---\n\n# x\n\nbody\n";

  /** A committed repo whose plugin is `under` (default: the repo root), with cases a (skill x), b (skill y), t (trigger) and a `base` branch at the commit. */
  const repo = async (under = ""): Promise<{ repo: string; root: string }> => {
    const plugin = makePlugin([
      { name: "a", tags: ["x"] },
      { name: "b", tags: ["y"] },
      { name: "t", tags: [TRIGGER_TAG] },
    ]);
    const top = under === "" ? plugin : mkdtempSync(join(tmpdir(), "run-evals-repo-"));
    const root = under === "" ? plugin : join(top, under);
    if (under !== "") {
      mkdirSync(dirname(root), { recursive: true });
      renameSync(plugin, root);
      writeFileSync(join(top, "other.txt"), "sibling\n");
    }
    mkdirSync(join(root, "skills", "x"), { recursive: true });
    mkdirSync(join(root, "skills", "y"), { recursive: true });
    writeFileSync(join(root, "skills", "x", "SKILL.md"), SKILL_X);
    writeFileSync(join(root, "skills", "y", "SKILL.md"), SKILL_X.replaceAll("x", "y"));
    for (const args of [["init", "-q"], ["add", "."], ["commit", "-q", "-m", "init"], ["branch", "base"]]) {
      const r = await git(top, ...args);
      expect(r.status, r.stderr).toBe(0);
    }
    return { repo: top, root };
  };

  it("selects nothing when nothing changed", async () => {
    const { root } = await repo();
    await expect(select(root)).resolves.toEqual({
      ok: true,
      ref: "base",
      paths: [],
      names: [],
      unmapped: [],
    });
  });

  it("selects an uncommitted case edit", async () => {
    const { root } = await repo();
    appendFileSync(join(root, "evals", "a", "case.yaml"), "# edited\n");
    const r = await select(root);
    expect(r).toEqual({ ok: true, ref: "base", paths: ["evals/a/case.yaml"], names: ["a"], unmapped: [] });
  });

  it("selects the cases of a committed skill change plus an untracked new case", async () => {
    const { root } = await repo();
    appendFileSync(join(root, "skills", "y", "SKILL.md"), "more\n");
    expect((await git(root, "commit", "-q", "-am", "skill")).status).toBe(0);
    mkdirSync(join(root, "evals", "d"));
    writeFileSync(
      join(root, "evals", "d", "case.yaml"),
      readFileSync(join(root, "evals", "b", "case.yaml"), "utf8").replace("name: b", "name: d"),
    );
    const r = await select(root);
    expect(r.ok && r.names).toEqual(["b", "d"]);
  });

  it("reports changed files that select nothing", async () => {
    const { root } = await repo();
    writeFileSync(join(root, "README.md"), "docs\n");
    const r = await select(root);
    expect(r).toEqual({ ok: true, ref: "base", paths: ["README.md"], names: [], unmapped: ["README.md"] });
  });

  it("reads paths with spaces and non-ASCII names intact", async () => {
    const { root } = await repo();
    writeFileSync(join(root, "evals", "a", "fixture é.txt"), "x\n");
    const r = await select(root);
    expect(r.ok && r.paths).toEqual(["evals/a/fixture é.txt"]);
    expect(r.ok && r.names).toEqual(["a"]);
  });

  it("scopes the diff to a plugin that is a subdirectory of its repo", async () => {
    const { repo: top, root } = await repo("plugins/p");
    appendFileSync(join(top, "other.txt"), "changed outside the plugin\n");
    writeFileSync(join(top, "untracked-outside.txt"), "x\n");
    appendFileSync(join(root, "evals", "a", "case.yaml"), "# edited\n");
    // A body-only skill edit: the base-version frontmatter read must resolve the nested path too.
    appendFileSync(join(root, "skills", "x", "SKILL.md"), "more body\n");
    const r = await select(root);
    expect(r).toEqual({
      ok: true,
      ref: "base",
      paths: ["evals/a/case.yaml", "skills/x/SKILL.md"],
      names: ["a"],
      unmapped: [],
    });
  });

  it("selects every trigger case on a skill frontmatter change, only the skill's cases on a body change", async () => {
    const body = await repo();
    writeFileSync(join(body.root, "skills", "x", "SKILL.md"), SKILL_X.replace("body", "new body"));
    expect(await select(body.root)).toMatchObject({ names: ["a"] });
    const fm = await repo();
    writeFileSync(join(fm.root, "skills", "x", "SKILL.md"), SKILL_X.replace("does x", "does x and more"));
    expect(await select(fm.root)).toMatchObject({ names: ["a", "t"] });
    const fresh = await repo();
    mkdirSync(join(fresh.root, "skills", "z"));
    writeFileSync(join(fresh.root, "skills", "z", "SKILL.md"), "---\nname: z\n---\n");
    expect(await select(fresh.root)).toMatchObject({ names: ["t"] });
  });

  it("applies the frontmatter rule to agents/*.md too", async () => {
    const { root } = await repo();
    const agent = join(root, "agents", "x.md");
    mkdirSync(dirname(agent));
    writeFileSync(agent, SKILL_X);
    expect(await select(root)).toMatchObject({ names: ["a", "t"], unmapped: [] });
    expect((await git(root, "add", ".")).status).toBe(0);
    expect((await git(root, "commit", "-q", "-m", "agent")).status).toBe(0);
    expect((await git(root, "branch", "-f", "base")).status).toBe(0);
    writeFileSync(agent, SKILL_X.replace("body", "new body"));
    expect(await select(root)).toMatchObject({ names: ["a"] });
    writeFileSync(agent, SKILL_X.replace("does x", "does more"));
    expect(await select(root)).toMatchObject({ names: ["a", "t"] });
  });

  it("sees frontmatter behind a BOM or leading blank lines, and compares whole texts when neither side has any", async () => {
    const bom = await repo();
    writeFileSync(join(bom.root, "skills", "x", "SKILL.md"), `﻿\n\n${SKILL_X}`);
    expect(await select(bom.root)).toMatchObject({ names: ["a"] });
    const plain = await repo();
    const y = join(plain.root, "skills", "y", "SKILL.md");
    writeFileSync(y, "y, no frontmatter\n");
    expect((await git(plain.root, "commit", "-q", "-am", "plain")).status).toBe(0);
    expect((await git(plain.root, "branch", "-f", "base")).status).toBe(0);
    writeFileSync(y, "y, reworded\n");
    expect(await select(plain.root)).toMatchObject({ names: ["b", "t"] });
  });

  it("keeps the old path of a renamed skill, and selects on a deleted one", async () => {
    const moved = await repo();
    mkdirSync(join(moved.root, "skills", "z"));
    expect((await git(moved.root, "mv", "skills/x/SKILL.md", "skills/z/SKILL.md")).status).toBe(0);
    const r = await select(moved.root);
    expect(r.ok && r.paths).toEqual(["skills/x/SKILL.md", "skills/z/SKILL.md"]);
    expect(r).toMatchObject({ names: ["a", "t"], unmapped: [] });
    const gone = await repo();
    rmSync(join(gone.root, "skills", "x", "SKILL.md"));
    expect(await select(gone.root)).toMatchObject({ paths: ["skills/x/SKILL.md"], names: ["a", "t"] });
  });

  it("fails on a ref with no merge base", async () => {
    const { root } = await repo();
    const r = await select(root, "no-such-ref");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("no-such-ref");
  });

  it("refuses an eval dir that resolves outside the plugin", async () => {
    const { root } = await repo();
    const outside = mkdtempSync(join(tmpdir(), "run-evals-outside-"));
    renameSync(join(root, "evals"), join(outside, "evals"));
    symlinkSync(join(outside, "evals"), join(root, "evals"));
    const r = await select(root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("outside the plugin");
  });

  it("resolves the bare form from origin's HEAD, else origin/main", async () => {
    const root = makePlugin([{ name: "a" }]);
    const calls: string[][] = [];
    const fake = (head: string | undefined) => ({
      ...fakeIo({
        onGit: (args) => {
          calls.push([...args]);
          return args.includes("symbolic-ref")
            ? spawned(head === undefined ? { status: 1 } : { stdout: `${head}\n` })
            : spawned({ stdout: args.includes("merge-base") ? "abc\n" : "" });
        },
      }).io,
      realpath: realpathSync,
    });
    const withHead = await selectChanged(fake("origin/develop"), root, readSuite(root), noGrants, "");
    expect(withHead).toMatchObject({ ok: true, ref: "origin/develop" });
    expect(calls.find((c) => c.includes("merge-base"))).toContain("origin/develop");
    calls.length = 0;
    const fallback = await selectChanged(fake(undefined), root, readSuite(root), noGrants, "");
    expect(fallback).toMatchObject({ ok: true, ref: DEFAULT_CHANGED_REF });
    expect(calls.find((c) => c.includes("merge-base"))).toContain(DEFAULT_CHANGED_REF);
    const empty = await selectChanged(fake(""), root, readSuite(root), noGrants, "");
    expect(empty).toMatchObject({ ok: true, ref: DEFAULT_CHANGED_REF });
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
