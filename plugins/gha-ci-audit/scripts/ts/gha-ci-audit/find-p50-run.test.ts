import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findP50Run, main } from "./find-p50-run.ts";
import { fakeIo } from "./test-io.ts";

const run = (id: number, minutes: number, conclusion = "success") => ({
  id,
  conclusion,
  run_started_at: "2025-01-01T10:00:00Z",
  updated_at: new Date(Date.parse("2025-01-01T10:00:00Z") + minutes * 60000).toISOString(),
  created_at: "2025-01-01T09:59:00Z",
});

describe("findP50Run", () => {
  it("picks the successful run closest to the median", () => {
    const res = findP50Run([run(1, 2), run(2, 4), run(3, 6), run(4, 100, "failure"), run(5, 100, "cancelled")]);
    expect(res).toEqual({ runId: 2, durationMin: 4, createdAt: "2025-01-01T09:59:00Z", p50: 4, n: 3 });
  });

  it("accepts the wrapped API shape and breaks ties toward the earlier run", () => {
    expect(findP50Run({ workflow_runs: [run(1, 2), run(2, 4)] })?.runId).toBe(1);
  });

  it("is null without successful runs that have durations", () => {
    expect(findP50Run([run(1, 2, "failure"), { id: 2, conclusion: "success" }])).toBeNull();
  });
});

describe("main", () => {
  it("prints id, duration and created_at, with the summary on stderr", () => {
    const a = fakeIo(JSON.stringify([run(1, 2), run(2, 4), run(3, 6)]));
    expect(main([], a.io)).toBe(0);
    expect(a.out()).toBe("2  4.0m  2025-01-01T09:59:00Z\n");
    expect(a.err()).toBe("# p50=4.0m  n=3 successful runs\n");
  });

  it("reads a file and exits 1 when no run qualifies", () => {
    const f = join(mkdtempSync(join(tmpdir(), "p50-")), "runs.json");
    writeFileSync(f, JSON.stringify([{ id: 1, conclusion: "failure" }]));
    const a = fakeIo();
    expect(main([f], a.io)).toBe(1);
    expect(a.err()).toContain("No successful runs");
  });

  it("exits 1 on unreadable input, 2 on extra args, 0 on --help", () => {
    expect(main(["/nonexistent.json"], fakeIo().io)).toBe(1);
    expect(main(["a", "b"], fakeIo().io)).toBe(2);
    expect(main(["--help"], fakeIo().io)).toBe(0);
  });
});
