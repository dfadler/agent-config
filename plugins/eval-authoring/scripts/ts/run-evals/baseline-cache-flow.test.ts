/** The wrapper end to end with the baseline cache (#855): a two-arm run stores, a later run reuses. */
import { describe, expect, it } from "vitest";
import { CACHE_DIR } from "./baseline-cache.ts";
import { EXIT_FAILURE, EXIT_OK } from "./exit-codes.ts";
import { main } from "./run-evals.ts";
import { parse } from "./summary.ts";
import { at, fakeIo, makePlugin, must, spawned, type FakeIo, type FakeIoOptions } from "./test-support.ts";

interface G {
  name: string;
  passed: boolean;
  weight: number;
  scored: boolean;
}

const grader = (name: string, passed: boolean, scored = true): G => ({ name, passed, weight: 1, scored });
const run = (graders: G[]): object => {
  const scored = graders.filter((g) => g.scored);
  const score = scored.filter((g) => g.passed).length / scored.length;
  return { score, passed: score >= 1, costUsd: 0.05, error: null, graders };
};
const meanScore = (runs: readonly object[]): number =>
  runs.reduce((a, r) => a + Number(Reflect.get(r, "score")), 0) / runs.length;

/** The CLI's two-arm result for one case: `skill_fired` is with-only, so it is scored in neither arm and absent from the without arm. */
const twoArm = (name: string, withPass: boolean[], withoutPass: boolean[]): string => {
  const w = withPass.map((p) => run([grader("skill_fired", true, false), grader("answers", p)]));
  const wo = withoutPass.map((p) => run([grader("answers", p)]));
  return JSON.stringify({
    schemaVersion: 1,
    partial: false,
    costUsd: 0.3,
    suite: { threshold: 1 },
    cases: [{ name, arms: { with: w, without: wo }, aggregates: { score: meanScore(w), scoreWithout: meanScore(wo), delta: meanScore(w) - meanScore(wo) } }],
    aggregates: { casesTotal: 1 },
  });
};

/** `--ablation none`: the plugin arm alone, every grader scored, with-only ones too. */
const noneArm = (name: string, withPass: boolean[], skillFired = true): string => {
  const w = withPass.map((p) => run([grader("skill_fired", skillFired), grader("answers", p)]));
  return JSON.stringify({
    schemaVersion: 1,
    partial: false,
    costUsd: 0.15,
    suite: { threshold: 1 },
    cases: [{ name, arms: { with: w }, aggregates: { score: meanScore(w) } }],
    aggregates: { casesTotal: 1 },
  });
};

const caseOf = (args: readonly string[]): string => args[args.indexOf("--case") + 1] ?? "";
const isNone = (args: readonly string[]): boolean => args[args.indexOf("--ablation") + 1] === "none";
const cli = (s: FakeIo): readonly { readonly args: readonly string[] }[] =>
  s.calls.filter((c) => c.command === "claude" && c.args[0] === "plugin");
const stored = (s: FakeIo): [string, string][] => [...s.written].filter(([p]) => p.includes(`${CACHE_DIR}/`));
const writtenAs = (s: FakeIo, suffix: string): unknown =>
  parse([...s.written].find(([p]) => p.endsWith(suffix))?.[1]);
const status = (code: number): { spawn: ReturnType<typeof spawned> } => ({ spawn: spawned({ status: code }) });

const GOOD = (args: readonly string[]): { result: string } => ({ result: twoArm(caseOf(args), [true, true, true], [false, false, true]) });

/** A fake io; `files` seeds what an earlier run wrote (the fake io does not read its own writes). */
const io = (opts: FakeIoOptions = {}): FakeIo => fakeIo(opts);
const exec = (root: string, s: FakeIo, ...extra: string[]): Promise<number> =>
  main([root, "--case", "a", ...extra], { io: s.io, pluginsDir: "/p" });

describe("baseline cache", () => {
  it("a clean two-arm run stores the without arm; a second run with the same key runs the plugin arm only and splices it in", async () => {
    const root = makePlugin([{ name: "a" }]);
    const first = io({ onCli: GOOD });
    expect(await exec(root, first)).toBe(EXIT_OK);
    expect(isNone(must(cli(first)[0]).args)).toBe(false);
    expect(stored(first)).toHaveLength(1);

    const second = io({
      files: Object.fromEntries(stored(first)),
      // skill_fired fails in every none-mode run: none-mode exits 1, a two-arm run scores that grader in neither arm.
      onCli: (args) => ({ result: noneArm(caseOf(args), [true, true, true], false), ...status(1) }),
    });
    expect(await exec(root, second)).toBe(EXIT_OK);
    expect(isNone(must(cli(second)[0]).args)).toBe(true);
    const result = writtenAs(second, "aggregate-result.json");
    expect(at(result, "cases", 0, "aggregates")).toMatchObject({ score: 1, baselineCached: true });
    expect(Number(at(result, "cases", 0, "aggregates", "scoreWithout"))).toBeCloseTo(1 / 3, 9);
    expect(at(result, "cases", 0, "arms", "without")).toHaveLength(3);
    expect(second.err.join("")).toContain("baseline cache hit");
    expect(at(writtenAs(second, "run-evals-summary.json"), "invocations", 0)).toMatchObject({ baseline: "cached", cliStatus: 1, exit: EXIT_OK });
    expect(second.out.join("")).toContain("Baseline cache: the without arm of 1 of 1 case(s) was reused");
    expect(stored(second)).toHaveLength(0);
  });

  it("a cached case below the threshold after the splice exits 1 even when the none-mode run said 0", async () => {
    const root = makePlugin([{ name: "a" }]);
    const first = io({ onCli: (args) => ({ result: twoArm(caseOf(args), [true, true, true], [false, false, false]) }) });
    await exec(root, first);
    expect(stored(first)).toHaveLength(1);
    const second = io({ files: Object.fromEntries(stored(first)), onCli: (args) => ({ result: noneArm(caseOf(args), [true, false, true]) }) });
    expect(await exec(root, second)).toBe(EXIT_FAILURE);
  });

  it("does not store a run that exited with an error status", async () => {
    const root = makePlugin([{ name: "a" }]);
    const s = io({ onCli: (args) => ({ ...GOOD(args), ...status(2) }) });
    await exec(root, s);
    expect(stored(s)).toHaveLength(0);
  });

  it("does not store a result whose without arm is shorter than the tier's runs", async () => {
    const root = makePlugin([{ name: "a" }]);
    const s = io({ onCli: (args) => ({ result: twoArm(caseOf(args), [true, true, true], [false]) }) });
    await exec(root, s);
    expect(stored(s)).toHaveLength(0);
    expect(s.err.join("")).toContain("not stored (without arm has 1 runs, 3 asked)");
  });

  it("misses when the claude version or the tier's runs change", async () => {
    const root = makePlugin([{ name: "a" }]);
    const first = io({ onCli: GOOD });
    await exec(root, first);
    const files = Object.fromEntries(stored(first));
    const newVersion = io({ files, claudeVersion: "9.9.9", onCli: GOOD });
    await exec(root, newVersion);
    expect(isNone(must(cli(newVersion)[0]).args)).toBe(false);
    const thorough = io({ files, onCli: (args) => ({ result: twoArm(caseOf(args), [true, true, true, true, true], [false, false, true, true, true]) }) });
    await exec(root, thorough, "--tier", "thorough");
    expect(isNone(must(cli(thorough)[0]).args)).toBe(false);
  });

  it("misses when the case's own files change", async () => {
    const root = makePlugin([{ name: "a" }]);
    const probe = io({ onCli: GOOD });
    await exec(root, probe, "--dry-run");
    const key = /key (\w+)/.exec(probe.out.join(""))?.[1];
    // The fake io reads only what it is given, so seed one case file and change it between two dry runs.
    const dir = `${root}/evals/a`;
    const keyWith = async (text: string): Promise<string | undefined> => {
      const s = io({ files: { [`${dir}/case.yaml`]: text } });
      await exec(root, s, "--dry-run");
      return /key (\w+)/.exec(s.out.join(""))?.[1];
    };
    expect(key).toBeDefined();
    expect(await keyWith("one")).toBe(await keyWith("one"));
    expect(await keyWith("one")).not.toBe(await keyWith("two"));
  });

  it("--no-cache neither reads nor writes the cache", async () => {
    const root = makePlugin([{ name: "a" }]);
    const first = io({ onCli: GOOD });
    await exec(root, first);
    const s = io({ files: Object.fromEntries(stored(first)), onCli: GOOD });
    await exec(root, s, "--no-cache");
    expect(isNone(must(cli(s)[0]).args)).toBe(false);
    expect(stored(s)).toHaveLength(0);
    expect(s.err.join("")).not.toContain("baseline cache");
  });

  it("is off for --no-baseline and for one-arm tiers: no store, no splice", async () => {
    const root = makePlugin([{ name: "a", tags: ["quick"] }]);
    for (const extra of [["--no-baseline"], ["--tier", "quick"]]) {
      const s = io({ onCli: (args) => ({ result: noneArm(caseOf(args), [true]) }) });
      await exec(root, s, ...extra);
      expect(isNone(must(cli(s)[0]).args)).toBe(true);
      expect(stored(s)).toHaveLength(0);
      expect(s.err.join("")).not.toContain("baseline cache");
    }
  });

  it("--dry-run shows a miss, then a hit, per case", async () => {
    const root = makePlugin([{ name: "a" }]);
    const miss = io();
    await exec(root, miss, "--dry-run");
    expect(miss.out.join("")).toContain("baseline cache: miss");
    const first = io({ onCli: GOOD });
    await exec(root, first);
    const hit = io({ files: Object.fromEntries(stored(first)) });
    await exec(root, hit, "--dry-run");
    expect(hit.out.join("")).toContain("baseline cache: hit");
    expect(hit.out.join("")).toContain("--ablation none");
  });
});
