import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkRun, main } from "./check-status.ts";
import { fakeIo } from "./test-io.ts";

const tmp = (): string => mkdtempSync(join(tmpdir(), "check-status-"));

/** Build <iter>/<name>/with_skill with the given files (relative paths). */
const makeRun = (iter: string, name: string, files: Record<string, string>): string => {
  const run = join(iter, name, "with_skill");
  mkdirSync(run, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(run, rel, ".."), { recursive: true });
    writeFileSync(join(run, rel), body);
  }
  return run;
};

describe("checkRun", () => {
  it("reports everything missing for an empty run", () => {
    const s = checkRun(makeRun(tmp(), "e", {}));
    expect(s).toMatchObject({ hasReport: false, hasGrading: false, hasOutputs: false, complete: false, passRate: null });
  });

  it("a report without grading is incomplete", () => {
    const s = checkRun(makeRun(tmp(), "e", { "outputs/report.html": "<html/>" }));
    expect(s).toMatchObject({ hasReport: true, hasOutputs: true, hasGrading: false, complete: false });
  });

  it("report plus grading is complete and exposes the pass rate", () => {
    const s = checkRun(
      makeRun(tmp(), "e", {
        "outputs/report.html": "x",
        "grading.json": JSON.stringify({ summary: { pass_rate: 0.9 } }),
        "timing.json": "{}",
        "eval_metadata.json": "{}",
      }),
    );
    expect(s).toMatchObject({ complete: true, passRate: 0.9, hasTiming: true, hasMetadata: true });
  });

  it("tolerates an unreadable or odd grading.json", () => {
    expect(checkRun(makeRun(tmp(), "a", { "grading.json": "{oops" })).passRate).toBeNull();
    expect(checkRun(makeRun(tmp(), "b", { "grading.json": "[]" })).passRate).toBeNull();
    expect(checkRun(makeRun(tmp(), "c", { "grading.json": '{"summary":{"pass_rate":"x"}}' })).passRate).toBeNull();
  });
});

describe("main", () => {
  it("prints a table and exits 1 while any run is incomplete", () => {
    const iter = tmp();
    makeRun(iter, "eval-1", { "outputs/report.html": "x", "grading.json": '{"summary":{"pass_rate":0.125}}', "timing.json": "{}", "eval_metadata.json": "{}" });
    makeRun(iter, "eval-2", {});
    mkdirSync(join(iter, "not-an-eval"));
    const a = fakeIo();
    expect(main([iter], a.io)).toBe(1);
    const out = a.out();
    expect(out).toContain("PassRate");
    expect(out).toContain("  eval-1                  with_skill     ✓          ✓        ✓        ✓        12%\n");
    expect(out).toContain("  eval-2                  with_skill     ✗          ✗        ✗        —        —\n");
    expect(out).toContain("Graded: 1/2 runs    benchmark.json: ✗");
    expect(out).toContain("Some runs are incomplete");
    expect(out).not.toContain("not-an-eval");
  });

  it("exits 0 when every run is complete", () => {
    const iter = tmp();
    makeRun(iter, "e", { "outputs/report.html": "x", "grading.json": "{}" });
    writeFileSync(join(iter, "benchmark.json"), "{}");
    const a = fakeIo();
    expect(main([iter], a.io)).toBe(0);
    expect(a.out()).toContain("benchmark.json: ✓");
    expect(a.out()).toContain("All runs complete.");
  });

  it("exits 0 with a note when there are no eval directories", () => {
    const a = fakeIo();
    expect(main([tmp()], a.io)).toBe(0);
    expect(a.out()).toContain("No eval directories found");
  });

  it("exits 1 on a missing directory or bad usage", () => {
    expect(main(["/nonexistent/iter"], fakeIo().io)).toBe(1);
    expect(main([], fakeIo().io)).toBe(1);
    expect(main(["a", "b"], fakeIo().io)).toBe(1);
  });
});
