import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeRuns, main, runDurationMin } from "./analyze-runs.ts";
import { fakeIo } from "./test-io.ts";

const run = (conclusion: string | null, minutes: number, event = "push") => ({
  conclusion,
  event,
  run_started_at: "2025-01-01T10:00:00Z",
  updated_at: new Date(Date.parse("2025-01-01T10:00:00Z") + minutes * 60000).toISOString(),
});

describe("runDurationMin", () => {
  it("accepts the API shape and the projected {s, e} shape", () => {
    expect(runDurationMin(run("success", 4))).toBe(4);
    expect(runDurationMin({ s: "2025-01-01T10:00:00Z", e: "2025-01-01T10:03:00Z" })).toBe(3);
    expect(runDurationMin({})).toBeNull();
  });
});

describe("analyzeRuns", () => {
  it("reports when nothing completed", () => {
    expect(analyzeRuns({ workflow_runs: [run(null, 1), run("skipped", 1)] }, "conclusion")).toBe(
      "No completed runs found.\n",
    );
  });

  it("groups, ranks percentiles and buckets", () => {
    const runs = [run("success", 1), run("success", 3), run("success", 10), run("failure", 40)];
    const out = analyzeRuns(runs, "conclusion");
    expect(out).toContain("Completed runs: 4  (total in payload: 4)");
    expect(out).toContain("  success: n=3, avg=4.7m, median=3.0m, stdev=4.7m");
    expect(out).toContain("  failure: n=1, avg=40.0m, median=40.0m, stdev=0.0m");
    expect(out).toContain("p50=10.0m  p90=40.0m  p99=40.0m  max=40.0m");
    expect(out).toContain("  <2m     :    1 (25.0%) ████████████");
    expect(out).toContain("  >30m    :    1 (25.0%) ████████████");
  });

  it("groups by event and counts runs missing timestamps", () => {
    const out = analyzeRuns(
      { workflow_runs: [run("success", 2, "push"), run("success", 2, "schedule"), { conclusion: "success" }] },
      "event",
    );
    expect(out).toContain("By event:");
    expect(out).toContain("  push: n=1");
    expect(out).toContain("(skipped 1 runs with missing timestamps)");
  });

  it("stops after the group table when no run has a duration", () => {
    const out = analyzeRuns([{ conclusion: "success" }], "conclusion");
    expect(out).toContain("skipped 1 runs");
    expect(out).not.toContain("percentiles");
  });

  it("uses the real p99 for 100+ runs", () => {
    const runs = Array.from({ length: 101 }, (_, i) => run("success", i + 1));
    expect(analyzeRuns(runs, "conclusion")).toContain("p99=100.0m  max=101.0m");
  });
});

describe("main", () => {
  it("reads stdin, honours --group-by, and prints help", () => {
    const a = fakeIo(JSON.stringify([run("success", 2)]));
    expect(main(["--group-by", "event"], a.io)).toBe(0);
    expect(a.out()).toContain("By event:");
    const h = fakeIo();
    expect(main(["--help"], h.io)).toBe(0);
    expect(h.out()).toContain("Usage:");
  });

  it("reads a file argument", () => {
    const f = join(mkdtempSync(join(tmpdir(), "ar-")), "runs.json");
    writeFileSync(f, JSON.stringify({ workflow_runs: [run("success", 2)] }));
    const a = fakeIo();
    expect(main([f], a.io)).toBe(0);
    expect(a.out()).toContain("success: n=1");
  });

  it.each([[["--group-by", "bogus"]], [["a", "b"]], [["--nope"]]])("exits 2 on bad usage %j", (argv) => {
    expect(main(argv, fakeIo().io)).toBe(2);
  });

  it("exits 1 on unparseable input", () => {
    const a = fakeIo("not json");
    expect(main([], a.io)).toBe(1);
    expect(a.err()).toContain("error:");
  });
});
