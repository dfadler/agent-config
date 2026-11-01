import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSuite } from "../parser/index.ts";
import { boundaryPlan, boundaryReport, wilsonUpper } from "./boundary.ts";
import { EXIT_CONFIG, EXIT_OK, EXIT_PARTIAL } from "./exit-codes.ts";
import { main, parseArgs } from "./run-evals.ts";
import { renderSummary } from "./summary.ts";
import { fakeIo } from "./test-support.ts";

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

const caseYaml = (name: string, tags: readonly string[], grader: string, bounds: string): string =>
  [
    'schema_version: "1.1"',
    `name: ${name}`,
    `tags: [${tags.join(", ")}]`,
    "execution:",
    "  prompt: hello",
    "  allowed_tools: [Skill]",
    "graders:",
    `  - name: ${grader}`,
    "    type: tool_used",
    "    tool: Skill",
    `    input_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?alpha"'`,
    `    ${bounds}`,
    "",
  ].join("\n");

/** A plugin with negatives n1..n3 paired to twin `tw`, plus a plain case and a quick-tagged case. */
const plugin = (pairs: Record<string, readonly string[]> = {}): string => {
  const root = mkdtempSync(join(tmpdir(), "boundary-test-"));
  write(join(root, ".claude-plugin", "plugin.json"), '{"name":"pl"}');
  write(join(root, "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: abcde\n---\nbody\n");
  const tags = (n: string): string[] => ["trigger-boundary", ...(pairs[n] ?? ["pair:tw"])];
  ["n1", "n2", "n3"].forEach((n) => {
    write(join(root, "evals", n, "case.yaml"), caseYaml(n, tags(n), "quiet", "min: 0\n    max: 0"));
  });
  write(join(root, "evals", "tw", "case.yaml"), caseYaml("tw", ["trigger"], "fired", "min: 1"));
  write(join(root, "evals", "plain", "case.yaml"), caseYaml("plain", ["quick"], "fired", "min: 1"));
  return root;
};

const resultFor = (caseName: string, grader: string, passed: boolean, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    partial: false,
    costUsd: 0.05,
    cases: [{ name: caseName, arms: { with: [{ graders: [{ name: grader, passed }], ...extra }], without: [] } }],
  });

/** Results as the wrapper reads them: which negatives fired, whether the twin did. */
const results = (fired: readonly string[], twinFired: boolean, errored: readonly string[] = []) => [
  ...["n1", "n2", "n3"].map((n) => ({
    caseName: n,
    text: resultFor(n, "quiet", !fired.includes(n), errored.includes(n) ? { error: "rate limited" } : {}),
  })),
  { caseName: "tw", text: resultFor("tw", "fired", twinFired) },
];

describe("wilsonUpper", () => {
  it.each([
    [0, 3, 0.5615],
    [0, 10, 0.278],
    [0, 20, 0.161],
    [0, 30, 0.114],
    [0, 60, 0.06],
    [1, 10, 0.404],
    [10, 10, 1],
  ])("%i fires in %i trials is at most %f", (k, n, want) => {
    expect(wilsonUpper(k, n)).toBeCloseTo(want, 3);
  });

  it("is undefined with no trials", () => {
    expect(wilsonUpper(0, 0)).toBeUndefined();
  });
});

describe("boundaryPlan", () => {
  it("lists the negatives and their twin in suite order, and nothing else", () => {
    const plan = boundaryPlan(readSuite(plugin()));
    expect(plan).toEqual({ ok: true, names: ["n1", "n2", "n3", "tw"] });
  });

  it("refuses a negative with no pair tag, a pair that is not a case, and a suite with no negative", () => {
    const reason = (p: ReturnType<typeof boundaryPlan>): string => (p.ok ? "" : p.reason);
    expect(reason(boundaryPlan(readSuite(plugin({ n2: [] }))))).toContain("case 'n2' has no 'pair:<case>' tag");
    expect(reason(boundaryPlan(readSuite(plugin({ n3: ["pair:ghost"] }))))).toContain("pair 'ghost'");
    expect(reason(boundaryPlan(readSuite(plugin({ n1: ["pair:tw", "pair:n2"] }))))).toContain("has 2 pair: tags");
    const noMatcher = plugin();
    write(join(noMatcher, "evals", "tw", "case.yaml"), caseYaml("tw", ["trigger"], "fired", "min: 1").replace(/ {4}input_match.*\n/, ""));
    expect(reason(boundaryPlan(readSuite(noMatcher)))).toContain("pairs with 'tw', which has no named must-fire check");
    const none = mkdtempSync(join(tmpdir(), "boundary-none-"));
    write(join(none, "evals", "tw", "case.yaml"), caseYaml("tw", ["trigger"], "fired", "min: 1"));
    expect(boundaryPlan(readSuite(none))).toMatchObject({ ok: false });
  });
});

describe("boundaryReport", () => {
  const suite = readSuite(plugin());

  it("counts fires over usable negatives and bounds the rate once a twin fired", () => {
    const r = boundaryReport(suite, results(["n2"], true));
    expect([r.fires, r.negatives, r.twinsRun, r.twinsFired]).toEqual([1, 3, 1, 1]);
    expect(r.withheld).toBeUndefined();
    expect(r.upper).toBeCloseTo(wilsonUpper(1, 3) ?? NaN, 10);
    expect(r.rows.map((x) => [x.caseName, x.fired, x.twin, x.twinFired])).toEqual([
      ["n1", false, "tw", true],
      ["n2", true, "tw", true],
      ["n3", false, "tw", true],
    ]);
  });

  it("withholds the bound when no twin fired, but still counts the fires", () => {
    const r = boundaryReport(suite, results([], false));
    expect(r.upper).toBeUndefined();
    expect(r.withheld).toMatch(/no should-fire twin fired/);
    expect([r.fires, r.negatives, r.twinsFired]).toEqual([0, 3, 0]);
  });

  it("does not count an errored run as quiet", () => {
    const r = boundaryReport(suite, results([], true, ["n3"]));
    expect(r.negatives).toBe(2);
    expect(r.rows.find((x) => x.caseName === "n3")?.fired).toBeUndefined();
  });

  it("counts a twin's fire only on the paired negative's own target", () => {
    const root = plugin();
    // tw also checks a different skill; that check passing must not release the bound.
    write(
      join(root, "evals", "tw", "case.yaml"),
      caseYaml("tw", ["trigger"], "fired", "min: 1") +
        [
          "  - name: other_fired",
          "    type: tool_used",
          "    tool: Skill",
          `    input_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?beta"'`,
          "    min: 1",
          "",
        ].join("\n"),
    );
    const text = JSON.stringify({
      schemaVersion: 1,
      partial: false,
      cases: [{ name: "tw", arms: { with: [{ graders: [{ name: "fired", passed: false }, { name: "other_fired", passed: true }] }], without: [] } }],
    });
    const r = boundaryReport(readSuite(root), [...results([], false).filter((x) => x.caseName !== "tw"), { caseName: "tw", text }]);
    expect(r.twinsFired).toBe(0);
    expect(r.withheld).toMatch(/no should-fire twin fired/);
  });

  it("gives no verdict on a prompt when one of its must-not-fire checks has none", () => {
    const root = plugin();
    write(
      join(root, "evals", "n1", "case.yaml"),
      caseYaml("n1", ["trigger-boundary", "pair:tw"], "quiet", "min: 0\n    max: 0") +
        [
          "  - name: quiet_two",
          "    type: tool_used",
          "    tool: Skill",
          `    input_match: '"skill"\\s*:\\s*"(?:[\\w-]+:)?alpha"'`,
          "    min: 0",
          "    max: 0",
          "",
        ].join("\n"),
    );
    // quiet passes but quiet_two never reports: n1 must not count as a clean prompt.
    const r = boundaryReport(readSuite(root), results([], true));
    expect(r.rows.find((x) => x.caseName === "n1")?.fired).toBeUndefined();
    expect(r.negatives).toBe(2);
  });

  it("withholds the bound when no negative has a usable run", () => {
    const r = boundaryReport(suite, results([], true, ["n1", "n2", "n3"]));
    expect(r.negatives).toBe(0);
    expect(r.withheld).toMatch(/no negative gave a usable run/);
  });
});

describe("renderSummary, trigger boundary section", () => {
  const suite = readSuite(plugin());
  const base = { plugin: "pl", tier: "trigger-boundary", model: "m", judgeModel: "j", spentUsd: 0, ceilingUsd: 1, exit: 0, command: "c", unstarted: [], cases: [] };

  it("prints the fire count, the Wilson bound, and the firing prompts to promote", () => {
    const text = renderSummary({ ...base, boundary: boundaryReport(suite, results(["n2"], true)) });
    expect(text).toContain("### Trigger boundary");
    expect(text).toContain("Fires: 1 of 3 negative prompts.");
    expect(text).toContain("Wilson 95% upper bound on the over-trigger rate: 79.2%.");
    expect(text).toContain("Vacuity control: 1 of 1 should-fire twins fired in this run.");
    expect(text).toContain("| n2 | fired | tw | fired |");
    expect(text).toContain("Fired: `n2`.");
  });

  it("prints no bound when the vacuity control failed", () => {
    const text = renderSummary({ ...base, boundary: boundaryReport(suite, results([], false)) });
    expect(text).toContain("Over-trigger bound withheld: no should-fire twin fired");
    expect(text).not.toContain("upper bound on the over-trigger rate");
  });
});

describe("--trigger-boundary", () => {
  const cliCalls = (calls: readonly { command: string; args: readonly string[] }[]) =>
    calls.filter((c) => c.command === "claude" && c.args[0] === "plugin");
  const caseOf = (args: readonly string[]): string => args[args.indexOf("--case") + 1] ?? "";

  /** The fake CLI answers each case with its own grader outcome. */
  const go = async (fired: readonly string[], twinFired: boolean, extra: string[] = []) => {
    const root = plugin();
    const fake = fakeIo({
      onCli: (args) => {
        const c = caseOf(args);
        return { result: c === "tw" ? resultFor(c, "fired", twinFired) : resultFor(c, "quiet", !fired.includes(c)) };
      },
    });
    const code = await main([root, "--trigger-boundary", ...extra], { io: fake.io, pluginsDir: dirname(root) });
    return { code, ...fake };
  };

  it("runs the negatives and the twin once each, plugin arm only, with threshold 0 and no tag", async () => {
    const r = await go([], true);
    const calls = cliCalls(r.calls);
    expect(calls.map((c) => caseOf(c.args))).toEqual(["n1", "n2", "n3", "tw"]);
    for (const c of calls) {
      expect(c.args[c.args.indexOf("--runs") + 1]).toBe("1");
      expect(c.args[c.args.indexOf("--threshold") + 1]).toBe("0");
      expect(c.args[c.args.indexOf("--ablation") + 1]).toBe("none");
      expect(c.args).not.toContain("--tag");
    }
    expect(r.code).toBe(EXIT_OK);
    expect(r.out.join("")).toContain("Fires: 0 of 3 negative prompts.");
  });

  it("leaves the exit code alone when negatives fire, and records the count in the summary file", async () => {
    const r = await go(["n1", "n3"], true);
    expect(r.code).toBe(EXIT_OK);
    const file = [...r.written].find(([p]) => p.endsWith("run-evals-summary.json"));
    expect(JSON.parse(file?.[1] ?? "{}")).toMatchObject({ triggerBoundary: { fires: 2, negatives: 3 } });
    expect(file?.[1]).toContain('"upper"');
  });

  it("exits 7 and withholds the bound when no twin fired", async () => {
    const r = await go([], false);
    expect(r.code).toBe(EXIT_PARTIAL);
    expect(r.err.join("")).toContain("over-trigger bound withheld");
    expect(r.out.join("")).toContain("bound withheld");
  });

  it("exits 3 before any run when a negative has no pair tag", async () => {
    const root = plugin({ n1: [] });
    const fake = fakeIo();
    expect(await main([root, "--trigger-boundary"], { io: fake.io, pluginsDir: dirname(root) })).toBe(EXIT_CONFIG);
    expect(cliCalls(fake.calls)).toHaveLength(0);
  });

  it("is a fixed tier: refuses --tier, --neighbours and --changed", () => {
    for (const extra of [["--tier", "quick"], ["--neighbours", "x"], ["--changed"], ["--case", "n1"]]) {
      expect(parseArgs(["p", "--trigger-boundary", ...extra])).toMatchObject({ kind: "error" });
    }
  });

  it("is left out of standard and thorough, which would score it against the no-plugin arm", async () => {
    for (const tier of ["standard", "thorough"]) {
      const root = plugin();
      const fake = fakeIo({ onCli: (args) => ({ result: resultFor(caseOf(args), "fired", true) }) });
      await main([root, "--tier", tier], { io: fake.io, pluginsDir: dirname(root) });
      expect(cliCalls(fake.calls).map((c) => caseOf(c.args))).toEqual(["plain", "tw"]);
    }
  });
});
