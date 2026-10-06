import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, mainWithDiscoveredRules } from "./cli.ts";
import { discoverRules, validateRules } from "./discover.ts";
import { formatJson, formatText, lintPlugin } from "./runner.ts";
import type { Rule } from "./types.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "eval-authoring-lint-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const put = (rel: string, text: string): void => {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
};

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "EVAL900",
  severity: "warn",
  title: "test rule",
  source: "from the test",
  checkCase: (c) => [
    { message: `case ${c.dirName}`, fix: "do the fix", loc: { file: c.dir, line: 3 } },
  ],
  ...over,
});

describe("validateRules", () => {
  const ok = rule({ id: "EVAL004" });
  it("accepts well-formed rules and sorts them by id", () => {
    const r = validateRules([
      { fileName: "eval010-b.ts", exported: rule({ id: "EVAL010" }) },
      { fileName: "eval004-a.ts", exported: ok },
    ]);
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.rules.map((x) => x.id)).toEqual(["EVAL004", "EVAL010"]);
  });

  it.each([
    ["a file name that is not a rule file", "helpers.ts", ok, "not a rule file name"],
    ["a missing export", "eval004-a.ts", undefined, "must export `rule`"],
    ["a rule with neither check function", "eval004-a.ts", { ...ok, checkCase: undefined }, "must export `rule`"],
    ["a bad severity", "eval004-a.ts", { ...ok, severity: "fatal" }, "must export `rule`"],
    ["an id that disagrees with the file name", "eval005-a.ts", ok, "file name says EVAL005"],
  ])("rejects %s", (_n, fileName, exported, message) => {
    const r = validateRules([{ fileName, exported }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain(message);
  });

  it("rejects two files with the same id", () => {
    const r = validateRules([
      { fileName: "eval004-a.ts", exported: ok },
      { fileName: "eval004-b.ts", exported: ok },
    ]);
    expect(!r.ok && r.message).toContain("duplicate rule id EVAL004");
  });
});

describe("discoverRules", () => {
  it("finds the structural rules", async () => {
    const r = await discoverRules();
    expect(r.ok && r.rules.map((x) => x.id)).toEqual(
      expect.arrayContaining(["EVAL001", "EVAL002", "EVAL003"]),
    );
  });
});

describe("lintPlugin", () => {
  it("attaches rule identity, honors overrides and runs suite rules once", () => {
    put("evals/b/prompt.md", "b");
    put("evals/a/prompt.md", "a");
    const suiteRule: Rule = {
      id: "EVAL901",
      severity: "info",
      title: "suite rule",
      source: "from the test",
      checkSuite: (ctx) => [
        {
          message: "suite",
          fix: "f",
          loc: { file: ctx.suite.evalDir, line: 1 },
          severity: "error",
          source: "overridden",
        },
      ],
    };
    const o = lintPlugin(root, [rule(), suiteRule]);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.report.casesChecked).toBe(2);
    const suite = o.report.findings.filter((f) => f.ruleId === "EVAL901");
    expect(suite).toHaveLength(1);
    expect(suite[0]).toMatchObject({
      severity: "error",
      source: "overridden",
      caseDirName: undefined,
    });
    const perCase = o.report.findings.filter((f) => f.ruleId === "EVAL900");
    expect(perCase.map((f) => [f.caseDirName, f.severity, f.source])).toEqual([
      ["a", "warn", "from the test"],
      ["b", "warn", "from the test"],
    ]);
  });

  it("reports a file the parser cannot read as PARSE", () => {
    put("evals/bad/case.yaml", "name: [unclosed\n");
    const o = lintPlugin(root, []);
    expect(o.ok && o.report.findings.map((f) => f.ruleId)).toContain("PARSE");
  });

  it("checks grants entries against the case names", () => {
    put("evals/a/prompt.md", "a");
    put("evals/grants.yaml", 'schema_version: "1"\ngrants:\n  ghost:\n    - Bash\n');
    const o = lintPlugin(root, []);
    expect(
      o.ok && o.report.findings.some((f) => f.message.includes("'ghost'")),
    ).toBe(true);
  });

  it("hands the grants file to rules", () => {
    put("evals/a/prompt.md", "a");
    put("evals/grants.yaml", 'schema_version: "1"\ngrants:\n  a:\n    - Bash\n');
    const seen: string[] = [];
    lintPlugin(root, [
      rule({
        checkCase: (c, ctx) => {
          seen.push(...ctx.grants.entries.map((e) => e.caseName));
          return [];
        },
      }),
    ]);
    expect(seen).toEqual(["a"]);
  });

  it("names the rule when it throws", () => {
    put("evals/a/prompt.md", "a");
    expect(() =>
      lintPlugin(root, [
        rule({
          checkCase: () => {
            throw new Error("boom");
          },
        }),
      ]),
    ).toThrow("rule EVAL900 threw: boom");
  });

  it("reports an unusable eval directory", () => {
    expect(lintPlugin(root, [], { evalDir: "../x" })).toMatchObject({
      ok: false,
      source: "flag",
    });
  });
});

describe("formatting", () => {
  it("text names the rule, the fix, the source and the schema version", () => {
    put("evals/a/prompt.md", "a");
    const o = lintPlugin(root, [rule()]);
    if (!o.ok) throw new Error("expected ok");
    const text = formatText(o.report);
    expect(text).toMatch(/Claude Code \d+\.\d+\.\d+/);
    expect(text).toContain(": warn EVAL900: case a");
    expect(text).toContain("Fix: do the fix");
    expect(text).toContain("Source: from the test");
    expect(text).toContain("0 error(s), 1 warning(s)");
  });

  it("json carries the same findings", () => {
    put("evals/a/prompt.md", "a");
    const o = lintPlugin(root, [rule()]);
    if (!o.ok) throw new Error("expected ok");
    const doc: unknown = JSON.parse(formatJson(o.report));
    expect(doc).toMatchObject({
      counts: { error: 0, warn: 1, info: 0 },
      findings: [{ ruleId: "EVAL900", fix: "do the fix" }],
    });
  });
});

describe("cli main", () => {
  const rules = [rule()];
  const errorRule = rule({
    id: "EVAL902",
    severity: "error",
  });

  it("prints help with output format and exit codes, exit 0", () => {
    const r = main(["--help"], rules);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("Fix: what to change");
    expect(r.stdout).toContain("Exit codes");
  });

  it("help wins over a bad option", () => {
    expect(main(["--bogus", "-h"], rules).code).toBe(0);
  });

  it("lists rules", () => {
    expect(main(["--list-rules"], rules).stdout).toContain("EVAL900  warn   test rule");
  });

  it.each([
    [["--bogus"], "unknown option"],
    [["--format"], "requires a value"],
    [["--format", "xml"], "--format must be"],
    [["a", "b"], "at most 1 argument"],
    [[join("/nonexistent", "plugin")], "not a directory"],
  ])("exit 2 for %j", (argv, message) => {
    const r = main(argv, rules);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(message);
  });

  it("exit 0 with only warnings, report on stdout", () => {
    put("evals/a/prompt.md", "a");
    const r = main([root], rules);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("EVAL900");
  });

  it("exit 1 with an error finding, report still on stdout", () => {
    put("evals/a/prompt.md", "a");
    const r = main(["--format=json", root], [errorRule]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('"ruleId": "EVAL902"');
  });

  it("exit 2 for a bad --eval-dir and 3 for a bad manifest eval dir", () => {
    expect(main(["--eval-dir", "../x", root], rules).code).toBe(2);
    put(
      ".claude-plugin/plugin.json",
      JSON.stringify({ name: "p", experimental: { evals: "/abs" } }),
    );
    expect(main([root], rules).code).toBe(3);
  });

  it("honors --grants and --eval-dir", () => {
    put("custom/a/prompt.md", "a");
    put("g.yaml", 'schema_version: "1"\ngrants:\n  ghost:\n    - Bash\n');
    const r = main(["--eval-dir", "custom", "--grants", join(root, "g.yaml"), root], []);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("'ghost'");
  });

  it("an empty plugin root lints clean", () => {
    expect(main([root], rules).stdout).toContain("0 case(s)");
  });
});

describe("mainWithDiscoveredRules", () => {
  it("runs the real rules end to end", async () => {
    put("evals/a/prompt.md", "no grader here");
    const r = await mainWithDiscoveredRules([root]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("error EVAL001");
  });
});
