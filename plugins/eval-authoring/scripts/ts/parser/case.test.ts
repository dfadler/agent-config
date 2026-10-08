import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCase, readSuite, resolveEvalDir } from "./case.ts";
import { getSchema } from "./schema.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eval-authoring-case-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, text: string): string => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
};

const REPO_PLUGINS = join(import.meta.dirname, "..", "..", "..", "..");

describe("readCase: prompt.md layout", () => {
  it("reads frontmatter, body and graders/*.md, defaulting the rest", () => {
    put(
      "c/prompt.md",
      "---\nruns: 5\nallowed_tools: [Read, Bash(npx *)]\ntags: [a]\n---\nDo the thing.\n",
    );
    put(
      "c/graders/b-judge.md",
      "---\ntype: llm\nweight: 2\n---\nPASS if good.\nFAIL if bad.\n",
    );
    put("c/graders/a-free.md", "---\ntype: tool_used\ntool: Skill\n---\n");
    const c = readCase(join(root, "c"));
    expect(c.layout).toBe("prompt-md");
    expect(c.name).toMatchObject({ value: "c", explicit: false });
    expect(c.runs).toMatchObject({ value: 5, explicit: true });
    expect(c.maxTurns).toMatchObject({ value: 10, explicit: false });
    expect(c.timeoutSeconds.value).toBe(300);
    expect(c.allowedTools.value.map((t) => [t.tool, t.specifier])).toEqual([
      ["Read", undefined],
      ["Bash", "npx *"],
    ]);
    expect(c.prompt.value).toBe("Do the thing.\n");
    expect(c.prompt.loc.line).toBe(6);
    expect(c.graders.map((g) => g.name.value)).toEqual(["a-free", "b-judge"]);
    const judge = c.graders[1];
    expect(judge?.type === "llm" && judge.criteria.value).toBe(
      "PASS if good.\nFAIL if bad.\n",
    );
    expect(judge?.weight).toMatchObject({ value: 2, explicit: true });
    expect(c.issues).toEqual([]);
  });

  it("reports an unknown prompt.md key", () => {
    put("c/prompt.md", "---\nbogus: 1\nruns: 2\n---\nhi");
    const c = readCase(join(root, "c"));
    expect(c.keys.find((k) => k.name === "bogus")).toMatchObject({
      status: "unknown",
      origin: "prompt.md",
      loc: { line: 2 },
    });
    expect(c.keys.find((k) => k.name === "runs")?.status).toBe("known");
  });

  it("has no graders when none exist", () => {
    put("c/prompt.md", "hi");
    expect(readCase(join(root, "c")).graders).toEqual([]);
  });

  it("reports malformed frontmatter and bad YAML without throwing", () => {
    put("a/prompt.md", "---\nruns: 1\n");
    put("b/prompt.md", "---\nruns: [1\n---\nbody");
    expect(readCase(join(root, "a")).issues[0]?.kind).toBe(
      "malformed-frontmatter",
    );
    expect(readCase(join(root, "b")).issues[0]?.kind).toBe("yaml-syntax");
  });

  it("reports a directory with neither prompt.md nor case.yaml", () => {
    mkdirSync(join(root, "empty"));
    expect(readCase(join(root, "empty")).issues[0]?.kind).toBe(
      "unreadable-file",
    );
  });

  it("falls back to the default and reports a wrong-typed value", () => {
    put("c/prompt.md", "---\nruns: many\ntags: nope\n---\nx");
    const c = readCase(join(root, "c"));
    expect(c.runs).toMatchObject({ value: 3, explicit: true });
    expect(c.issues.map((i) => i.kind)).toEqual(["wrong-type", "wrong-type"]);
  });
});

describe("readCase: case.yaml layout", () => {
  const CASE_YAML = [
    'schema_version: "1.1"',
    "name: yc",
    "tags: [t]",
    "execution:",
    "  prompt: |",
    "    Run it.",
    "  max_turns: 6",
    "  allowed_tools:",
    "    - Bash",
    "  env:",
    "    EVAL_X: '1'",
    "context:",
    "  scaffold_script: s.sh",
    "  add_dirs: [res]",
    "graders:",
    "  - name: g1",
    "    type: tool_used",
    "    tool: Bash",
    "    max: 0",
    "    min: 0",
    "    arm: both",
    "  - name: g2",
    "    type: regex",
    "    pattern: foo",
    "    target: { source: file, path: out.txt }",
    "  - name: g3",
    "    type: llm",
    "    criteria: PASS if x",
    "    focus: mock_calls",
    "  - name: g4",
    "    type: tool_order",
    "    before: { tool: A, input_match: x }",
    "    after: B",
    "  - name: g5",
    "    type: file_exists",
    "    path: '*.md'",
    "    exists: false",
    "  - name: g6",
    "    type: baseline",
    "    baseline_file: b.jsonl",
    "",
  ].join("\n");

  it("reads execution, context and inline graders with provenance", () => {
    put("c/case.yaml", CASE_YAML);
    const c = readCase(join(root, "c"));
    expect(c.layout).toBe("case-yaml");
    expect(c.schemaVersion.value).toBe("1.1");
    expect(c.name.value).toBe("yc");
    expect(c.prompt.value).toBe("Run it.\n");
    expect(c.maxTurns).toMatchObject({ value: 6, explicit: true });
    expect(c.env.value).toMatchObject([{ key: "EVAL_X", value: "1" }]);
    expect(c.scaffoldScript.value).toBe("s.sh");
    expect(c.addDirs.value).toEqual(["res"]);
    expect(c.graders.map((g) => g.type)).toEqual([
      "tool_used",
      "regex",
      "llm",
      "tool_order",
      "file_exists",
      "baseline",
    ]);
    const [g1, g2, g3, g4, g5] = c.graders;
    expect(g1?.type === "tool_used" && g1.min).toMatchObject({
      value: 0,
      explicit: true,
    });
    expect(g1?.type === "tool_used" && g1.max.value).toBe(0);
    expect(g2?.type === "regex" && g2.target.value).toEqual({
      kind: "file",
      path: "out.txt",
    });
    expect(g2?.type === "regex" && g2.match).toMatchObject({
      value: "contains",
      explicit: false,
    });
    expect(g3?.type === "llm" && g3.focus.value).toEqual({
      kind: "mock_calls",
    });
    expect(g4?.type === "tool_order" && [g4.before.value, g4.after.value]).toEqual(
      ["A", "B"],
    );
    expect(g5?.type === "file_exists" && g5.exists.value).toBe(false);
    expect(g1?.origin).toMatchObject({ source: "case.yaml", index: 0 });
    expect(c.issues).toEqual([]);
    expect(c.keys.every((k) => k.status === "known")).toBe(true);
  });

  it("defaults tool_used.min to 1 as not explicit", () => {
    put(
      "c/case.yaml",
      'schema_version: "1.1"\nname: c\ngraders:\n  - type: tool_used\n    tool: Bash\n    max: 0\n',
    );
    const g = readCase(join(root, "c")).graders[0];
    expect(g?.type === "tool_used" && g.min).toMatchObject({
      value: 1,
      explicit: false,
    });
  });

  it("classifies misplaced and unknown keys", () => {
    put(
      "c/case.yaml",
      'schema_version: "1.1"\nname: c\nmax_turns: 4\nscaffold_script: x\nzzz: 1\nexecution:\n  tags: [a]\n  prompt: p\n',
    );
    const keys = readCase(join(root, "c")).keys;
    expect(keys.find((k) => k.name === "max_turns")).toMatchObject({
      status: "misplaced",
      belongsUnder: "case.yaml:execution",
    });
    expect(keys.find((k) => k.name === "scaffold_script")).toMatchObject({
      status: "misplaced",
      belongsUnder: "case.yaml:context",
    });
    expect(keys.find((k) => k.name === "zzz")?.status).toBe("unknown");
    expect(keys.find((k) => k.name === "tags")).toMatchObject({
      origin: "case.yaml:execution",
      status: "misplaced",
      belongsUnder: "case.yaml",
    });
    // A misplaced key is not read as a value.
    expect(readCase(join(root, "c")).maxTurns.explicit).toBe(false);
  });

  it("keeps an unknown grader type as an unknown grader", () => {
    put(
      "c/case.yaml",
      'schema_version: "1.1"\nname: c\ngraders:\n  - name: x\n    type: magic\n    extra: 1\n  - name: y\n',
    );
    const c = readCase(join(root, "c"));
    expect(c.graders.map((g) => g.type)).toEqual(["unknown", "unknown"]);
    const g = c.graders[0];
    expect(g?.type === "unknown" && g.rawType.value).toBe("magic");
    const second = c.graders[1];
    expect(second?.type === "unknown" && second.rawType.explicit).toBe(false);
  });

  it("reports bad graders / execution shapes", () => {
    put(
      "c/case.yaml",
      'schema_version: "1.1"\nname: c\nexecution: nope\ngraders:\n  - just-a-string\n',
    );
    expect(readCase(join(root, "c")).issues.map((i) => i.message)).toEqual([
      "'execution' must be a mapping",
      "a grader must be a mapping",
    ]);
    put("d/case.yaml", 'schema_version: "1.1"\nname: d\ngraders: x\n');
    expect(readCase(join(root, "d")).issues[0]?.message).toBe(
      "'graders' must be a list",
    );
  });

  it("numbers graders by position in the final list, skipping dropped ones", () => {
    put(
      "c/case.yaml",
      'schema_version: "1.1"\nname: c\ngraders:\n  - dropped\n  - name: kept\n    type: regex\n    pattern: x\n',
    );
    put("c/graders/a-bad.md", "---\ntype: llm\n");
    put("c/graders/b-good.md", "---\ntype: file_exists\npath: a\n---\n");
    const c = readCase(join(root, "c"));
    expect(c.graders.map((g) => [g.name.value, g.origin.index])).toEqual([
      ["kept", 0],
      ["b-good", 1],
    ]);
  });

  it("flags a missing schema_version as absent", () => {
    put("c/case.yaml", "name: c\n");
    expect(readCase(join(root, "c")).schemaVersion.value).toBeUndefined();
  });
});

describe("readCase: mixed layout", () => {
  it("lets prompt.md override case.yaml and appends graders/*.md after inline graders", () => {
    put(
      "c/case.yaml",
      [
        'schema_version: "1.1"',
        "name: from-yaml",
        "runs: 2",
        "execution:",
        "  max_turns: 4",
        "  prompt: yaml prompt",
        "graders:",
        "  - name: inline",
        "    type: regex",
        "    pattern: x",
        "",
      ].join("\n"),
    );
    put("c/prompt.md", "---\nname: from-md\nmax_turns: 9\n---\nmd prompt");
    put("c/graders/late.md", "---\ntype: file_exists\npath: a\n---\n");
    const c = readCase(join(root, "c"));
    expect(c.layout).toBe("mixed");
    expect(c.name.value).toBe("from-md");
    expect(c.maxTurns).toMatchObject({ value: 9, explicit: true });
    expect(c.runs.value).toBe(2);
    expect(c.prompt.value).toBe("md prompt");
    expect(c.graders.map((g) => g.name.value)).toEqual(["inline", "late"]);
    expect(c.graders[1]?.origin).toMatchObject({
      source: "graders-md",
      index: 1,
    });
    expect(c.schemaVersion.value).toBe("1.1");
  });
});

describe("the real fetch-execute-guide cases", () => {
  it("parse cleanly", () => {
    const suite = readSuite(join(REPO_PLUGINS, "fetch-execute-guide"));
    expect(suite.cases.map((c) => c.name.value)).toEqual([
      "fetch-execute-asks-first",
      "fetch-execute-runs-with-permission",
      "fetch-execute-stays-quiet-on-lockfile-install",
    ]);
    suite.cases.forEach((c) => {
      expect(c.issues).toEqual([]);
      expect(c.keys.filter((k) => k.status !== "known")).toEqual([]);
      expect(c.graders.length).toBeGreaterThan(0);
    });
  });
});

describe("resolveEvalDir", () => {
  it("defaults to evals", () => {
    expect(resolveEvalDir(root)).toEqual({
      ok: true,
      dir: getSchema().defaultEvalDir,
      source: "default",
    });
  });
  it("uses the manifest's experimental.evals", () => {
    put(
      ".claude-plugin/plugin.json",
      JSON.stringify({ name: "p", experimental: { evals: "tests/evals/" } }),
    );
    expect(resolveEvalDir(root)).toEqual({
      ok: true,
      dir: "tests/evals",
      source: "manifest",
    });
  });
  it("lets the flag win over the manifest", () => {
    put(
      ".claude-plugin/plugin.json",
      JSON.stringify({ experimental: { evals: "m" } }),
    );
    expect(resolveEvalDir(root, { flag: "f" })).toMatchObject({
      ok: true,
      dir: "f",
      source: "flag",
    });
  });
  it.each(["/abs", "../up", "a/../b", "./x", "a//b", "", "a\\b", "C:/x"])(
    "rejects %j",
    (bad) => {
      expect(resolveEvalDir(root, { flag: bad })).toMatchObject({
        ok: false,
        source: "flag",
      });
    },
  );
  it("rejects a bad manifest value and ignores junk manifests", () => {
    put(".claude-plugin/plugin.json", '{"experimental":{"evals":"../x"}}');
    expect(resolveEvalDir(root)).toMatchObject({ ok: false, source: "manifest" });
    put(".claude-plugin/plugin.json", "not json");
    expect(resolveEvalDir(root).ok).toBe(true);
    put(".claude-plugin/plugin.json", '{"experimental":{"evals":3}}');
    expect(resolveEvalDir(root)).toMatchObject({ source: "default" });
    put(".claude-plugin/plugin.json", '{"experimental":1}');
    expect(resolveEvalDir(root)).toMatchObject({ source: "default" });
    put(".claude-plugin/plugin.json", "[]");
    expect(resolveEvalDir(root)).toMatchObject({ source: "default" });
  });
});

describe("readSuite", () => {
  it("finds cases in name order, skipping non-case directories", () => {
    put("evals/zeta/prompt.md", "z");
    put("evals/alpha/case.yaml", 'schema_version: "1.1"\nname: alpha\n');
    put("evals/mocks/srv/tool.md", "x");
    put("evals/results/run1/aggregate-result.json", "{}");
    put("evals/.hidden/prompt.md", "h");
    put("evals/onlygraders/graders/g.md", "---\ntype: llm\n---\nc");
    const s = readSuite(root);
    expect(s.cases.map((c) => c.dirName)).toEqual([
      "alpha",
      "onlygraders",
      "zeta",
    ]);
    expect(s.evalDir).toBe(join(root, "evals"));
    expect(s.issues).toEqual([]);
  });

  it("reads the suite's mock catalog", () => {
    put("evals/a/prompt.md", "a");
    put("evals/mocks/srv/tool.md", "---\ntype: agent\n---\nreply");
    const s = readSuite(root);
    expect(s.mocks.mocks.map((m) => [m.server, m.tool, m.typeKind])).toEqual([
      ["srv", "tool", "agent"],
    ]);
    expect([...s.mocks.declaredServers]).toEqual(["srv"]);
  });

  it("honors --eval-dir and a missing directory", () => {
    put("custom/x/prompt.md", "x");
    expect(readSuite(root, { flag: "custom" }).cases).toHaveLength(1);
    expect(readSuite(root).cases).toEqual([]);
  });

  it("reports an eval directory that is a regular file instead of throwing", () => {
    put("evals", "not a directory");
    const s = readSuite(root);
    expect(s.cases).toEqual([]);
    expect(s.issues.map((i) => i.kind)).toEqual(["wrong-type"]);
    expect(s.issues[0]?.message).toContain("not a directory");
  });

  // Permission bits do not restrict root, and Windows ignores them.
  const canRestrict = process.platform !== "win32" && process.getuid?.() !== 0;

  it.skipIf(!canRestrict)(
    "reports an unreadable eval directory or graders directory instead of throwing",
    () => {
      put("evals/c/prompt.md", "x");
      put("evals/c/graders/g.md", "---\ntype: llm\n---\nc");
      try {
        chmodSync(join(root, "evals", "c", "graders"), 0o000);
        const c = readCase(join(root, "evals", "c"));
        expect(c.graders).toEqual([]);
        expect(c.issues.map((i) => i.kind)).toEqual(["unreadable-file"]);
        chmodSync(join(root, "evals"), 0o000);
        const s = readSuite(root);
        expect(s.cases).toEqual([]);
        expect(s.issues.map((i) => i.kind)).toEqual(["unreadable-file"]);
      } finally {
        chmodSync(join(root, "evals"), 0o755);
        chmodSync(join(root, "evals", "c", "graders"), 0o755);
      }
    },
  );

  it("reports a bad eval directory instead of throwing", () => {
    const s = readSuite(root, { flag: "../x" });
    expect(s.cases).toEqual([]);
    expect(s.issues[0]?.kind).toBe("wrong-type");
  });
});
