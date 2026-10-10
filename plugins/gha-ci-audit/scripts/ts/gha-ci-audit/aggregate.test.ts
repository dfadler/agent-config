import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aggregate, generateBenchmark, generateMarkdown, loadAll, loadRun, main, stats, type Run } from "./aggregate.ts";
import { fakeIo, readObj } from "./test-io.ts";

const NOW = new Date("2025-03-31T12:00:00.500Z");

const makeRun = (over: Partial<Run> = {}): Run => ({
  eval_id: 1,
  eval_name: "vite-audit",
  configuration: "with_skill",
  pass_rate: 0.8,
  passed: 4,
  failed: 1,
  total: 5,
  time_seconds: 90,
  tokens: 2000,
  tool_calls: 8,
  errors: 0,
  expectations: [{ text: "report exists", passed: true }],
  notes: [],
  ...over,
});

/** <iter>/<name>/with_skill with the given JSON files. */
const writeRun = (iter: string, name: string, files: Record<string, unknown>): string => {
  const dir = join(iter, name, "with_skill");
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(join(dir, f), typeof body === "string" ? body : JSON.stringify(body));
  return dir;
};
const tmp = (): string => mkdtempSync(join(tmpdir(), "aggregate-"));

describe("stats", () => {
  it("handles empty, single and multiple values", () => {
    expect(stats([])).toEqual({ mean: 0, stddev: 0, min: 0, max: 0 });
    expect(stats([5])).toEqual({ mean: 5, stddev: 0, min: 5, max: 5 });
    expect(stats([1, 2, 3])).toEqual({ mean: 2, stddev: 1, min: 1, max: 3 });
  });

  it("rounds to 4 places like Python (half-even on exact ties)", () => {
    expect(stats([0.03125]).mean).toBe(0.0312);
    expect(stats([1, 2]).stddev).toBe(0.7071);
  });
});

describe("loadRun", () => {
  const warnings: string[] = [];
  const warn = (s: string): void => {
    warnings.push(s);
  };

  it("is null without grading.json and warns on bad JSON", () => {
    expect(loadRun(writeRun(tmp(), "e", {}), warn)).toBeNull();
    expect(loadRun(writeRun(tmp(), "e", { "grading.json": "not json{" }), warn)).toBeNull();
    expect(warnings.join("")).toContain("Warning: bad JSON");
    expect(loadRun(writeRun(tmp(), "e", { "grading.json": "[]" }), warn)).toBeNull();
  });

  it("reads summary, metrics, metadata, timing and notes", () => {
    const dir = writeRun(tmp(), "folder-name", {
      "grading.json": {
        summary: { pass_rate: 0.75, passed: 3, failed: 1, total: 4 },
        execution_metrics: { total_tool_calls: 10, errors_encountered: 2 },
        expectations: [{ text: "x" }],
        user_notes_summary: { uncertainties: ["u"], needs_review: ["n"], workarounds: ["w"], ignored: ["z"] },
      },
      "eval_metadata.json": { eval_id: 7, eval_name: "vite-audit" },
      "timing.json": { total_duration_seconds: 120, total_tokens: 5000 },
    });
    expect(loadRun(dir, warn)).toEqual({
      eval_id: 7,
      eval_name: "vite-audit",
      configuration: "with_skill",
      pass_rate: 0.75,
      passed: 3,
      failed: 1,
      total: 4,
      time_seconds: 120,
      tokens: 5000,
      tool_calls: 10,
      errors: 2,
      expectations: [{ text: "x" }],
      notes: ["u", "n", "w"],
    });
  });

  it("defaults the name to the eval folder and times from grading.json when timing.json has none", () => {
    const dir = writeRun(tmp(), "folder-name", {
      "grading.json": { summary: "not-an-object", timing: { total_duration_seconds: 33 } },
      "timing.json": { total_duration_seconds: 0 },
    });
    expect(loadRun(dir, warn)).toMatchObject({ eval_id: 0, eval_name: "folder-name", pass_rate: 0, time_seconds: 33, tokens: 0 });
  });
});

describe("loadAll", () => {
  it("skips non-eval entries and warns about runs without grading", () => {
    const iter = tmp();
    writeRun(iter, "b-eval", { "grading.json": { summary: { pass_rate: 1 } } });
    writeRun(iter, "a-eval", { "grading.json": { summary: { pass_rate: 0.5 } } });
    writeRun(iter, "ungraded", {});
    mkdirSync(join(iter, "no-with-skill"));
    writeFileSync(join(iter, "benchmark.json"), "{}");
    const warnings: string[] = [];
    const runs = loadAll(iter, (s) => warnings.push(s));
    expect(runs.map((r) => r.eval_name)).toEqual(["a-eval", "b-eval"]);
    expect(warnings.join("")).toContain("no grading.json in");
  });
});

describe("aggregate / generateBenchmark / generateMarkdown", () => {
  it("aggregates pass rate, time and tokens", () => {
    expect(aggregate([]).with_skill.pass_rate.mean).toBe(0);
    const ws = aggregate([makeRun({ pass_rate: 0.6, time_seconds: 10 }), makeRun({ pass_rate: 1, time_seconds: 20 })]).with_skill;
    expect(ws.pass_rate.mean).toBe(0.8);
    expect(ws.time_seconds.mean).toBe(15);
    expect(ws.tokens.mean).toBe(2000);
  });

  it("builds the benchmark structure", () => {
    expect(generateBenchmark([makeRun({ configuration: "without_skill" })], "s", "p", "m", NOW).metadata.runs_per_configuration).toBe(0);
    const b = generateBenchmark([makeRun(), makeRun({ eval_id: 3 }), makeRun({ eval_id: 1 })], "gha-ci-audit", "skills/gha-ci-audit", "claude-opus-5-5", NOW);
    expect(b.metadata).toEqual({
      skill_name: "gha-ci-audit",
      skill_path: "skills/gha-ci-audit",
      executor_model: "claude-opus-5-5",
      analyzer_model: "claude-opus-5-5",
      timestamp: "2025-03-31T12:00:00Z",
      evals_run: [1, 3],
      runs_per_configuration: 3,
    });
    expect(b.runs[0]).toMatchObject({ eval_name: "vite-audit", run_number: 1, result: { pass_rate: 0.8, passed: 4, tool_calls: 8 } });
  });

  it("renders markdown with the summary table and per-eval lines", () => {
    const b = generateBenchmark([makeRun({ pass_rate: 0.125, time_seconds: 90.5 })], "gha-ci-audit", "p", "m", NOW);
    expect(generateMarkdown(b)).toBe(
      [
        "# Benchmark: gha-ci-audit",
        "",
        "**Date**: 2025-03-31T12:00:00Z  **Model**: m",
        "**Evals**: 1",
        "",
        "## Summary",
        "",
        "| Metric | With Skill |",
        "|--------|-----------|",
        "| Pass Rate | 12% ± 0% |",
        "| Time (s)  | 90.5 ± 0.0 |",
        "| Tokens    | 2000.0 ± 0.0 |",
        "",
        "## Per-eval results",
        "",
        "- **vite-audit** (with_skill): 12% (4/5) — 90s",
      ].join("\n"),
    );
  });

  it("appends notes when present", () => {
    const b = { ...generateBenchmark([makeRun()], "s", "p", "m", NOW), notes: ["careful"] };
    expect(generateMarkdown(b)).toMatch(/\n## Notes\n\n- careful$/);
  });
});

describe("main", () => {
  const graded = (): string => {
    const iter = tmp();
    writeRun(iter, "eval-1", { "grading.json": { summary: { pass_rate: 1, passed: 2, failed: 0, total: 2 } } });
    return iter;
  };

  it("writes benchmark.json and benchmark.md and threads --model", () => {
    const iter = graded();
    const a = fakeIo();
    expect(main([iter, "--model", "claude-opus-5-5"], a.io, NOW)).toBe(0);
    const data = readObj(join(iter, "benchmark.json"));
    expect(data["metadata"]).toMatchObject({ executor_model: "claude-opus-5-5", analyzer_model: "claude-opus-5-5", skill_name: "gha-ci-audit" });
    expect(a.out()).toContain(`Generated: ${join(iter, "benchmark.md")}`);
    expect(a.out()).toContain("Pass rate: 100.0%");
  });

  it("defaults the model and honours --output", () => {
    const iter = graded();
    const out = join(iter, "custom.json");
    expect(main([iter, "-o", out], fakeIo().io, NOW)).toBe(0);
    expect(readObj(out)["metadata"]).toMatchObject({ executor_model: "claude-sonnet-4-6" });
    expect(readObj(join(iter, "custom.json"))).toBeTruthy();
  });

  it("exits 1 when the directory is missing or nothing is graded", () => {
    expect(main(["/nonexistent/iter"], fakeIo().io)).toBe(1);
    const a = fakeIo();
    expect(main([tmp()], a.io)).toBe(1);
    expect(a.err()).toContain("No graded runs found.");
  });

  it("exits 2 on bad usage and 0 on --help", () => {
    expect(main([], fakeIo().io)).toBe(2);
    expect(main(["a", "b"], fakeIo().io)).toBe(2);
    expect(main(["--bogus"], fakeIo().io)).toBe(2);
    expect(main(["--help"], fakeIo().io)).toBe(0);
  });
});
