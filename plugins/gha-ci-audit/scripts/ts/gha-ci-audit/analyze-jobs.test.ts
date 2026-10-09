import { describe, expect, it } from "vitest";
import { analyzeJobs, classifyRunner, jobDurationMin, main } from "./analyze-jobs.ts";
import { fakeIo } from "./test-io.ts";

const job = (name: string, start: string, end: string | null, extra: object = {}) => ({
  name,
  started_at: `2025-01-01T${start}Z`,
  completed_at: end === null ? null : `2025-01-01T${end}Z`,
  conclusion: "success",
  runner_name: "ubuntu-latest",
  ...extra,
});

const JOBS = {
  jobs: [
    job("build", "10:00:00", "10:10:00", {
      steps: [
        { name: "checkout", started_at: "2025-01-01T10:00:00Z", completed_at: "2025-01-01T10:00:30Z", conclusion: "success" },
        { name: "compile", conclusion: "success" },
      ],
    }),
    job("lint", "10:00:00", "10:02:00", { runner_name: "runs-on--i-abc" }),
    job("flow check", "10:05:00", "10:09:50", { runner_name: "custom" }),
    job("pending", "10:00:00", null),
  ],
};

describe("classifyRunner / jobDurationMin", () => {
  it.each([
    ["", "unknown"],
    ["runs-on--i-1", "self-hosted"],
    ["my-self-hosted", "self-hosted"],
    ["Ubuntu-22.04", "github-hosted"],
    ["custom", "unknown"],
  ])("classifies %j as %s", (name, kind) => {
    expect(classifyRunner(name)).toBe(kind);
  });

  it("returns null without both timestamps or when reversed", () => {
    expect(jobDurationMin({ started_at: "2025-01-01T10:00:00Z" })).toBeNull();
    expect(jobDurationMin(job("x", "10:05:00", "10:00:00"))).toBeNull();
    expect(jobDurationMin(job("x", "10:00:00", "10:03:00"))).toBe(3);
  });
});

describe("analyzeJobs", () => {
  const out = analyzeJobs(JOBS, { top: 10, steps: false });

  it("summarises wall-clock, billable minutes and parallelism", () => {
    expect(out).toContain("Jobs in run:  3 completed");
    expect(out).toContain("Wall-clock:   10.0m");
    expect(out).toContain("Total job-min (billable estimate): 16.8m  (parallelism factor: 1.7x)");
  });

  it("lists the jobs finishing within 30s of the end as the critical path", () => {
    expect(out).toContain("Critical path (2 job(s) finishing last):");
    expect(out).toContain("  [github-hosted] build: 10.0m  conclusion=success");
    expect(out).toContain("  [unknown] flow check: 4.8m  conclusion=success");
    expect(out).not.toContain("[self-hosted] lint: 2.0m  conclusion");
  });

  it("breaks down runner types and flags critical jobs in the top list", () => {
    expect(out).toContain("  self-hosted: 1 jobs, 2.0 job-min total");
    expect(out).toContain("  10.0m  build  ★ CRITICAL");
    expect(out).toContain("   2.0m  lint  \n");
  });

  it("limits the top list", () => {
    expect(analyzeJobs(JOBS, { top: 1, steps: false })).toContain("Top 1 longest jobs:");
  });

  it("filters case-insensitively and reports the count", () => {
    const filtered = analyzeJobs(JOBS, { filter: "FLOW", top: 10, steps: false });
    expect(filtered.startsWith('Filtered to jobs matching "FLOW": 1 jobs\n\n')).toBe(true);
    expect(filtered).toContain("Jobs in run:  1 completed");
  });

  it("reports when nothing completed", () => {
    expect(analyzeJobs([job("a", "10:00:00", null)], { top: 10, steps: false })).toBe("No completed jobs found.\n");
  });

  it("prints step breakdowns for critical jobs, tolerating missing step data", () => {
    const s = analyzeJobs(JOBS, { top: 10, steps: true });
    expect(s).toContain("Steps for: build");
    expect(s).toContain("  0.5m    checkout  (success)");
    expect(s).toContain("  —       compile  (success)");
    expect(s).toContain("No step data for: flow check");
  });

  it("omits the billable line when no job has a duration", () => {
    const s = analyzeJobs([job("rev", "10:05:00", "10:00:00")], { top: 10, steps: false });
    expect(s).not.toContain("Total job-min");
    expect(s).toContain("[github-hosted] rev: ?m");
  });
});

describe("main", () => {
  it("reads stdin and applies flags", () => {
    const a = fakeIo(JSON.stringify(JOBS));
    expect(main(["--filter", "build", "--top", "5", "--steps"], a.io)).toBe(0);
    expect(a.out()).toContain("Steps for: build");
  });

  it("prints help", () => {
    const a = fakeIo();
    expect(main(["-h"], a.io)).toBe(0);
    expect(a.out()).toContain("Usage:");
  });

  it.each([[["--top", "x"]], [["a", "b"]], [["--nope"]]])("exits 2 on bad usage %j", (argv) => {
    expect(main(argv, fakeIo().io)).toBe(2);
  });

  it("exits 1 on unreadable input", () => {
    expect(main(["/nonexistent/jobs.json"], fakeIo().io)).toBe(1);
  });
});
