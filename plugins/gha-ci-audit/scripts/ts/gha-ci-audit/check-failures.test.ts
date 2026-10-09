import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkFailures, failureJson, formatFailureReport, main } from "./check-failures.ts";
import { fakeIo, readObj } from "./test-io.ts";

const runs = (conclusions: string[]) =>
  conclusions.map((conclusion) => ({ conclusion, created_at: "2025-01-01T10:00:00Z" }));

describe("checkFailures", () => {
  it("is healthy below the thresholds", () => {
    const r = checkFailures(runs(["success", "success", "failure", "success"]));
    expect(r.chronic).toBe(false);
    expect(r.failureRate).toBe(0.25);
    expect(formatFailureReport(r)).toEqual([
      "failure_rate=0.25  failures=1/4",
      "consecutive_streak=0  earliest_in_streak=",
      "chronic=no",
    ]);
  });

  it("is chronic by rate (over 40%)", () => {
    expect(checkFailures(runs([...Array<string>(5).fill("failure"), "success", "success"])).chronic).toBe(true);
    // Exactly 40% is not chronic.
    expect(checkFailures(runs(["failure", "failure", "success", "success", "success"])).chronic).toBe(false);
  });

  it("is chronic by a head streak of 5, and reports its earliest run", () => {
    const list = runs(Array<string>(5).fill("failure")).map((r, i) => ({ ...r, created_at: `2025-01-0${String(5 - i)}T00:00:00Z` }));
    const r = checkFailures([...list, ...runs(["success"])]);
    expect(r.chronic).toBe(true);
    expect(r.streak).toBe(5);
    expect(r.earliestInStreak).toBe("2025-01-01T00:00:00Z");
    expect(r.details).toContain("consecutive_streak=5 earliest_in_streak=2025-01-01T00:00:00Z");
  });

  it("a head streak of 5 is chronic even when the overall rate is low", () => {
    const r = checkFailures(runs([...Array<string>(5).fill("failure"), ...Array<string>(8).fill("success")]));
    expect(r.failureRate).toBeLessThan(0.4);
    expect(r.chronic).toBe(true);
  });

  it("a streak of 4 is not enough on its own", () => {
    const r = checkFailures(runs([...Array<string>(4).fill("failure"), ...Array<string>(8).fill("success")]));
    expect(r.chronic).toBe(false);
    expect(r.streak).toBe(4);
  });

  it("ignores skipped and in-progress runs and accepts the wrapped shape", () => {
    const r = checkFailures({ workflow_runs: [{ conclusion: null }, { conclusion: "skipped" }, ...runs(["failure"])] });
    expect(r.completed).toBe(1);
    expect(r.failureRate).toBe(1);
  });

  it("reports no_data", () => {
    const r = checkFailures([]);
    expect(r.noData).toBe(true);
    expect(formatFailureReport(r)).toEqual(["no_data"]);
    expect(failureJson(r)).toEqual({ chronic: false, failure_rate: 0, details: "no_data" });
  });

  it("rounds an exact tie to even like Python (1 of 8 = 0.12)", () => {
    expect(checkFailures(runs(["failure", ...Array<string>(7).fill("success")])).failureRate).toBe(0.12);
  });
});

describe("main", () => {
  const file = (data: unknown): string => {
    const f = join(mkdtempSync(join(tmpdir(), "cf-")), "runs.json");
    writeFileSync(f, JSON.stringify(data));
    return f;
  };

  it("exits 0 and prints the report when healthy", () => {
    const a = fakeIo();
    expect(main([file(runs(["success", "failure", "success"]))], a.io)).toBe(0);
    expect(a.out()).toContain("chronic=no");
  });

  it("exits 1 when chronic and writes --output JSON", () => {
    const out = join(mkdtempSync(join(tmpdir(), "cf-")), "failure_check.json");
    const a = fakeIo(JSON.stringify(runs(Array<string>(5).fill("failure"))));
    expect(main(["--output", out], a.io)).toBe(1);
    expect(a.out()).toContain("chronic=YES");
    expect(readObj(out)).toMatchObject({ chronic: true, failure_rate: 1 });
    expect(typeof readObj(out)["details"]).toBe("string");
  });

  it("writes the no_data summary", () => {
    const out = join(mkdtempSync(join(tmpdir(), "cf-")), "f.json");
    expect(main([file([]), "--output", out], fakeIo().io)).toBe(0);
    expect(readObj(out)).toEqual({ chronic: false, failure_rate: 0, details: "no_data" });
  });

  it("prints help, rejects bad usage, and reports unreadable input as 2 (not 'chronic')", () => {
    const h = fakeIo();
    expect(main(["--help"], h.io)).toBe(0);
    expect(h.out()).toContain("Usage:");
    expect(main(["a", "b"], fakeIo().io)).toBe(2);
    expect(main(["--nope"], fakeIo().io)).toBe(2);
    const bad = fakeIo("not json");
    expect(main([], bad.io)).toBe(2);
    expect(bad.err()).toContain("error:");
  });
});
