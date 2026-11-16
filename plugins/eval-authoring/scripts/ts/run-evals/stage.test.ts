import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPluginManifest, readSuite, resolveCasePath } from "../parser/index.ts";
import { nodeIo } from "./io.ts";
import { addPluginsLine, checkNeighbours, parseNeighbours, stageNeighbours } from "./stage.ts";

const write = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

const CASE_YAML = (name: string): string =>
  [
    'schema_version: "1.1"',
    `name: ${name}`,
    "tags: [trigger]",
    "execution:",
    "  prompt: hello",
    "graders:",
    "  - name: g",
    "    type: regex",
    "    pattern: hi",
    "",
  ].join("\n");

/** plugins/{target,sib}: target has a case.yaml case, a prompt.md case, a results dir and a .git; sib has skills and its own evals. */
const world = (extraCase?: { dir: string; text: string }) => {
  const pluginsDir = mkdtempSync(join(tmpdir(), "stage-test-"));
  const target = join(pluginsDir, "target");
  write(join(target, ".claude-plugin", "plugin.json"), '{"name":"target"}');
  write(join(target, "evals", "c1", "case.yaml"), CASE_YAML("c1"));
  write(
    join(target, "evals", "c2", "prompt.md"),
    "---\nname: c2\ntags: [trigger]\n---\nhello there\n",
  );
  write(join(target, "evals", "c2", "graders", "g.md"), "---\ntype: regex\npattern: hi\n---\n");
  write(join(target, "evals", "results", "run-1", "aggregate-result.json"), "{}");
  write(join(target, ".git", "HEAD"), "ref");
  write(join(target, "skills", "t", "SKILL.md"), "---\nname: t\ndescription: x\n---\n");
  const sib = join(pluginsDir, "sib");
  write(join(sib, ".claude-plugin", "plugin.json"), '{"name":"sib"}');
  write(join(sib, "skills", "s", "SKILL.md"), "---\nname: s\ndescription: y\n---\n");
  write(join(sib, "evals", "x", "case.yaml"), CASE_YAML("x"));
  if (extraCase !== undefined) write(join(target, extraCase.dir), extraCase.text);
  return { pluginsDir, target, io: nodeIo(process.env) };
};

describe("parseNeighbours", () => {
  it("takes a comma list of plugin names and refuses anything else", () => {
    expect(parseNeighbours("a,b-c,d.e_f")).toEqual(["a", "b-c", "d.e_f"]);
    expect(parseNeighbours("a,,b")).toBeUndefined();
    expect(parseNeighbours("a,a")).toBeUndefined();
    expect(parseNeighbours("../x")).toBeUndefined();
    expect(parseNeighbours("a/b")).toBeUndefined();
    expect(parseNeighbours("")).toBeUndefined();
  });
});

describe("addPluginsLine", () => {
  it("appends to a case.yaml, also one that ends in a block scalar", () => {
    const out = addPluginsLine("a: 1\ng: |\n  text\n\n", "yaml", ["..", "../n"]);
    expect(out).toBe('a: 1\ng: |\n  text\nplugins: ["..","../n"]\n');
  });
  it("inserts after the opening fence of a prompt.md", () => {
    expect(addPluginsLine("---\nname: c\n---\nbody\n", "frontmatter", ["."])).toBe(
      '---\nplugins: ["."]\nname: c\n---\nbody\n',
    );
  });
});

describe("checkNeighbours", () => {
  it("accepts a sibling plugin and names the problem otherwise", () => {
    const w = world();
    expect(checkNeighbours(w.io, w.pluginsDir, w.target, ["sib"])).toBeUndefined();
    expect(checkNeighbours(w.io, w.pluginsDir, w.target, ["sib", "nope"])).toMatch(/'nope' is not a plugin/);
    expect(checkNeighbours(w.io, w.pluginsDir, w.target, ["target"])).toMatch(/is the plugin under test/);
  });
});

describe("stageNeighbours", () => {
  it("builds a copy whose cases load the plugin and each neighbour from inside it, and leaves the original alone", () => {
    const w = world();
    const suite = readSuite(w.target, {});
    const staged = stageNeighbours(w.io, {
      target: w.target,
      pluginsDir: w.pluginsDir,
      evalDir: suite.evalDir,
      neighbours: ["sib"],
      cases: suite.cases,
    });
    if (!staged.ok) throw new Error(staged.reason);
    try {
      const copy = readSuite(staged.root, {});
      expect(copy.cases.map((c) => c.plugins.value)).toEqual([
        ["../..", "../../neighbours/sib"],
        ["../..", "../../neighbours/sib"],
      ]);
      // Each entry resolves inside the staged plugin, to the plugin itself and to the copied neighbour.
      const names = copy.cases.flatMap((c) =>
        c.plugins.value.map((e) => {
          const p = resolveCasePath(c.dir, e, staged.root);
          return [p.insidePluginRoot, p.exists, readPluginManifest(p.resolved).name] as const;
        }),
      );
      expect(names).toEqual([
        [true, true, "target"],
        [true, true, "sib"],
        [true, true, "target"],
        [true, true, "sib"],
      ]);
      // Left out of the copy: .git, results, and the neighbour's own evals. Kept: skills.
      expect(existsSync(join(staged.root, ".git"))).toBe(false);
      expect(existsSync(join(staged.root, "evals", "results"))).toBe(false);
      expect(existsSync(join(staged.root, "skills", "t", "SKILL.md"))).toBe(true);
      expect(existsSync(join(staged.root, "neighbours", "sib", "skills", "s", "SKILL.md"))).toBe(true);
      expect(existsSync(join(staged.root, "neighbours", "sib", "evals"))).toBe(false);
      // The committed cases are untouched.
      expect(readFileSync(join(w.target, "evals", "c1", "case.yaml"), "utf8")).toBe(CASE_YAML("c1"));
      expect(readSuite(w.target, {}).cases.every((c) => !c.plugins.explicit)).toBe(true);
    } finally {
      w.io.remove(staged.tempDir);
    }
    expect(existsSync(staged.tempDir)).toBe(false);
  });

  it("refuses a case that already lists plugins, naming it, and stages nothing", () => {
    const w = world();
    write(join(w.target, "evals", "c1", "case.yaml"), `${CASE_YAML("c1")}plugins: ["../.."]\n`);
    const suite = readSuite(w.target, {});
    const staged = stageNeighbours(w.io, {
      target: w.target,
      pluginsDir: w.pluginsDir,
      evalDir: suite.evalDir,
      neighbours: ["sib"],
      cases: suite.cases,
    });
    expect(staged).toMatchObject({ ok: false });
    expect(staged.ok ? "" : staged.reason).toMatch(/case 'c1' already has its own plugins:/);
  });

  it("stages only the cases it is given", () => {
    const w = world();
    const suite = readSuite(w.target, {});
    const staged = stageNeighbours(w.io, {
      target: w.target,
      pluginsDir: w.pluginsDir,
      evalDir: suite.evalDir,
      neighbours: ["sib"],
      cases: suite.cases.filter((c) => c.name.value === "c1"),
    });
    if (!staged.ok) throw new Error(staged.reason);
    try {
      const copy = readSuite(staged.root, {});
      expect(copy.cases.map((c) => [c.name.value, c.plugins.explicit])).toEqual([
        ["c1", true],
        ["c2", false],
      ]);
    } finally {
      w.io.remove(staged.tempDir);
    }
  });
});
