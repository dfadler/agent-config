import { describe, expect, it } from "vitest";
import { fetchWorkflowStats, main } from "./fetch-workflow-stats.ts";
import type { Gh } from "./gh.ts";
import { fakeIo } from "./test-io.ts";

const NOW = new Date("2025-03-31T12:00:00Z");
const RUNS = JSON.stringify([
  { s: "2025-01-01T10:00:00Z", e: "2025-01-01T10:06:00Z" },
  { s: "2025-01-01T10:00:00Z", e: "2025-01-01T10:04:00Z" },
]);

/** Route by URL like the real API: name, 30-day count, then the timing source. */
const fakeGh =
  (over: { name?: string | Error; count?: string | Error; runs?: string | Error } = {}): { gh: Gh; calls: string[][] } => {
    const calls: string[][] = [];
    const pick = (v: string | Error | undefined, dflt: string): string => {
      if (v instanceof Error) throw v;
      return v ?? dflt;
    };
    const gh: Gh = (args) => {
      calls.push([...args]);
      const url = args[0] ?? "";
      if (url.includes("per_page=100")) return pick(over.runs, RUNS);
      if (url.includes("per_page=1&")) return pick(over.count, "25\n");
      return pick(over.name, "Test Workflow\n");
    };
    return { gh, calls };
  };

describe("fetchWorkflowStats", () => {
  it("prints a header, a rule and one aligned row per workflow", () => {
    const { gh, calls } = fakeGh();
    const out = fetchWorkflowStats("o/r", ["12345", "678"], gh, NOW).split("\n");
    expect(out[0]).toBe(
      "WF_ID         NAME                                      RUNS_30D   AVG_MIN   P90_MIN",
    );
    expect(out[1]).toBe("-".repeat(92));
    expect(out[2]).toBe(
      "12345         Test Workflow                                   25       5.0       6.0",
    );
    expect(out[3]).toContain("678 ");
    expect(calls[1]?.[0]).toBe("repos/o/r/actions/workflows/12345/runs?per_page=1&created=>=2025-03-01T12:00:00Z");
  });

  it("truncates long names to 40 characters", () => {
    const out = fetchWorkflowStats("o/r", ["1"], fakeGh({ name: "N".repeat(60) }).gh, NOW);
    expect(out).toContain(`${"N".repeat(40)}  `);
    expect(out).not.toContain("N".repeat(41));
  });

  it("degrades each failing cell instead of aborting", () => {
    const boom = new Error("boom");
    const out = fetchWorkflowStats("o/r", ["9"], fakeGh({ name: boom, count: boom, runs: boom }).gh, NOW);
    expect(out.split("\n")[2]).toMatch(/^9 +unknown +\? +\? +\?$/);
  });

  it("treats unparseable timing output as no data", () => {
    const out = fetchWorkflowStats("o/r", ["9"], fakeGh({ runs: "not json" }).gh, NOW);
    expect(out.split("\n")[2]).toMatch(/\? +\?$/);
  });
});

describe("main", () => {
  it("prints the table", () => {
    const a = fakeIo();
    expect(main(["o/r", "1"], a.io, fakeGh().gh, NOW)).toBe(0);
    expect(a.out()).toContain("Test Workflow");
  });

  it("exits 1 without a repo or without workflow IDs", () => {
    expect(main([], fakeIo().io)).toBe(1);
    const a = fakeIo();
    expect(main(["o/r"], a.io)).toBe(1);
    expect(a.err()).toContain("provide at least one workflow ID");
  });
});
