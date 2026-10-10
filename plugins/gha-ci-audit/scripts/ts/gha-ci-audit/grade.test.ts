import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkArtifactPublished,
  checkDataFilesSaved,
  checkFailureRate,
  checkRankedOpportunities,
  checkWorkflowCountFound,
  DEFAULT_EVALS_PATH,
  gradeAssertion,
  main,
} from "./grade.ts";
import { fakeIo, readObj } from "./test-io.ts";

/** A fresh outputs dir with the given files. */
const outputs = (files: Record<string, string> = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "grade-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
};

describe("checkArtifactPublished", () => {
  it("fails when the report is missing or under 1000 bytes", () => {
    expect(checkArtifactPublished(outputs())).toMatchObject({ passed: false, evidence: "report.html not found in outputs directory" });
    expect(checkArtifactPublished(outputs({ "report.html": "<html>tiny</html>" }))).toMatchObject({
      passed: false,
      evidence: "report.html exists but is only 17 bytes (< 1000)",
    });
    expect(checkArtifactPublished(outputs({ "report.html": "x".repeat(999) })).passed).toBe(false);
  });

  it("passes at 1000 bytes", () => {
    expect(checkArtifactPublished(outputs({ "report.html": "x".repeat(1000) })).passed).toBe(true);
  });
});

describe("checkWorkflowCountFound", () => {
  it("counts entries in workflows.json", () => {
    const two = JSON.stringify([{ id: 1 }, { id: 2 }]);
    expect(checkWorkflowCountFound(outputs({ "workflows.json": two }))).toMatchObject({ passed: true, evidence: "workflows.json contains 2 entries" });
    expect(checkWorkflowCountFound(outputs({ "workflows.json": '[{"id":1}]' })).passed).toBe(false);
  });

  it("falls back to table rows in report.html", () => {
    const html = "<table><tr><td>CI Workflow</td><td>push</td></tr><tr><td>Deploy Workflow</td><td>push</td></tr></table>";
    expect(checkWorkflowCountFound(outputs({ "report.html": html })).passed).toBe(true);
    // An unparseable or empty workflows.json also falls through to the report.
    expect(checkWorkflowCountFound(outputs({ "workflows.json": "oops", "report.html": html })).passed).toBe(true);
    expect(checkWorkflowCountFound(outputs({ "workflows.json": "[]", "report.html": html })).passed).toBe(true);
  });

  it("fails with too few rows or no files", () => {
    expect(checkWorkflowCountFound(outputs({ "report.html": "<tr><td>Only One</td></tr>" })).passed).toBe(false);
    expect(checkWorkflowCountFound(outputs())).toMatchObject({ passed: false, evidence: "Neither workflows.json nor report.html found" });
  });
});

describe("checkFailureRate", () => {
  it("fails without a report", () => {
    expect(checkFailureRate(outputs()).passed).toBe(false);
  });

  it("finds a percentage near 'failure', either side, and a 0.xx decimal", () => {
    expect(checkFailureRate(outputs({ "report.html": "<p>Failure rate: 12.5%</p>" }))).toMatchObject({
      passed: true,
      evidence: "Failure-rate pattern found in report text: 'Failure rate: 12.5%'",
    });
    expect(checkFailureRate(outputs({ "report.html": "<p>12% of runs fail</p>" })).passed).toBe(true);
    expect(checkFailureRate(outputs({ "report.html": "<p>failure rate 0.12 overall</p>" })).evidence).toBe("Failure rate value found in report.html: '0.12'");
  });

  it("falls back to text with tags stripped", () => {
    // The tag between the words defeats the first pattern ([^<]), the stripped text does not.
    const r = checkFailureRate(outputs({ "report.html": "<b>Failure</b> <i>rate</i> <u>is 7%</u>" }));
    expect(r.passed).toBe(true);
    expect(r.evidence).toContain("Failure-rate pattern found in report text");
  });

  it("fails when there is no rate", () => {
    expect(checkFailureRate(outputs({ "report.html": "<p>All good, no failures here.</p>" })).passed).toBe(false);
  });
});

describe("checkRankedOpportunities", () => {
  it("counts severity badges", () => {
    expect(
      checkRankedOpportunities(outputs({ "report.html": '<span class="sev-high">a</span><span class="sev-med">b</span>' })),
    ).toMatchObject({ passed: true, evidence: "Found 1 sev-high and 1 sev-med badges in report.html" });
    expect(checkRankedOpportunities(outputs({ "report.html": '<span class="sev-high">a</span>' })).passed).toBe(false);
  });

  it("falls back to opportunity-card prose", () => {
    const card = "<div>Opportunity: cache deps, high impact, will save minutes</div>";
    const r = checkRankedOpportunities(outputs({ "report.html": card + card }));
    expect(r.passed).toBe(true);
    expect(r.evidence).toContain("2 opportunity cards");
    expect(checkRankedOpportunities(outputs({ "report.html": card })).passed).toBe(false);
    expect(checkRankedOpportunities(outputs({ "report.html": "<p>nothing</p>" })).passed).toBe(false);
  });

  it("fails without a report", () => {
    expect(checkRankedOpportunities(outputs()).passed).toBe(false);
  });
});

describe("checkDataFilesSaved", () => {
  it("needs both files non-trivially sized", () => {
    expect(checkDataFilesSaved(outputs({ "runs.json": "[{}]", "jobs.json": "[{}]" }))).toMatchObject({
      passed: true,
      evidence: "runs.json (4 bytes) and jobs.json (4 bytes) both exist",
    });
    expect(checkDataFilesSaved(outputs({ "runs.json": "[{}]" }))).toMatchObject({ passed: false, evidence: "Missing or empty: jobs.json" });
    expect(checkDataFilesSaved(outputs({ "runs.json": "[", "jobs.json": "" }))).toMatchObject({
      passed: false,
      evidence: "Missing or empty: runs.json, jobs.json",
    });
  });
});

describe("gradeAssertion", () => {
  it("dispatches programmatic IDs", () => {
    const dir = outputs({ "report.html": "x".repeat(1001) });
    expect(gradeAssertion("artifact_published", "Report published", dir)).toMatchObject({ text: "Report published", passed: true });
    expect(gradeAssertion("artifact_published", "t", outputs()).passed).toBe(false);
    expect(gradeAssertion("failure_rate_computed", "t", outputs({ "report.html": "failure 5%" })).passed).toBe(true);
    expect(gradeAssertion("failure_rate_quantified", "t", outputs({ "report.html": "failure 5%" })).passed).toBe(true);
    expect(gradeAssertion("workflow_count_found", "t", outputs()).passed).toBe(false);
    expect(gradeAssertion("ranked_opportunities", "t", outputs()).passed).toBe(false);
    expect(gradeAssertion("data_files_saved", "t", outputs()).passed).toBe(false);
  });

  it("defers everything else to the AI grader", () => {
    expect(gradeAssertion("critical_path_identified", "LLM-graded", outputs())).toEqual({
      text: "LLM-graded",
      passed: null,
      evidence: "requires_ai_grader",
    });
  });
});

describe("main", () => {
  const evals = (extra: object[] = []): string => {
    const p = join(mkdtempSync(join(tmpdir(), "grade-evals-")), "evals.json");
    writeFileSync(
      p,
      JSON.stringify({
        evals: [
          { id: 1, assertions: [{ id: "artifact_published", text: "A" }, { id: "qualitative_thing", text: "B" }] },
          { id: 2, assertions: [{ id: "data_files_saved", text: "C" }] },
          ...extra,
        ],
      }),
    );
    return p;
  };

  /** <run>/outputs plus an optional eval_metadata.json beside it. */
  const run = (meta?: object, files: Record<string, string> = {}) => {
    const runDir = mkdtempSync(join(tmpdir(), "grade-run-"));
    const out = join(runDir, "outputs");
    mkdirSync(out);
    for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), body);
    if (meta !== undefined) writeFileSync(join(runDir, "eval_metadata.json"), JSON.stringify(meta));
    return { out, grading: join(runDir, "nested", "grading.json") };
  };

  it("grades the eval named by eval_metadata.json and writes grading.json", () => {
    const r = run({ eval_id: 2 }, { "runs.json": "[{}]", "jobs.json": "[{}]" });
    const a = fakeIo();
    expect(main(["--output-dir", r.out, "--grading-out", r.grading], a.io, evals())).toBe(0);
    expect(readObj(r.grading)).toEqual({
      assertions: [{ text: "C", passed: true, evidence: "runs.json (4 bytes) and jobs.json (4 bytes) both exist" }],
      overall_passed: null,
      summary: "1 passed, 0 failed programmatically; 0 require AI grading",
    });
    expect(a.out()).toContain("1 passed, 0 failed, 0 deferred to AI");
  });

  it("falls back to the first eval without metadata", () => {
    const r = run(undefined, { "report.html": "x".repeat(1001) });
    expect(main(["--output-dir", r.out, "--grading-out", r.grading], fakeIo().io, evals())).toBe(0);
    expect(readObj(r.grading)["summary"]).toBe("1 passed, 0 failed programmatically; 1 require AI grading");
  });

  it("falls back to the first eval for an unknown id, and tolerates an empty eval list", () => {
    const r = run({ eval_id: 99 });
    expect(main(["--output-dir", r.out, "--grading-out", r.grading], fakeIo().io, evals())).toBe(0);
    expect(readObj(r.grading)["summary"]).toBe("0 passed, 1 failed programmatically; 1 require AI grading");
    const empty = join(mkdtempSync(join(tmpdir(), "grade-evals-")), "evals.json");
    writeFileSync(empty, '{"evals":[]}');
    const r2 = run();
    expect(main(["--output-dir", r2.out, "--grading-out", r2.grading], fakeIo().io, empty)).toBe(0);
    expect(readObj(r2.grading)["assertions"]).toEqual([]);
  });

  it("ships an evals.json the default path can find", () => {
    const r = run({ eval_id: 1 });
    expect(main(["--output-dir", r.out, "--grading-out", r.grading], fakeIo().io, DEFAULT_EVALS_PATH)).toBe(0);
  });

  it("reports an unreadable evals.json and bad usage", () => {
    const r = run();
    const bad = fakeIo();
    expect(main(["--output-dir", r.out, "--grading-out", r.grading], bad.io, "/nonexistent/evals.json")).toBe(1);
    expect(bad.err()).toContain("cannot read");
    expect(main(["--output-dir", r.out], fakeIo().io)).toBe(2);
    expect(main(["--bogus"], fakeIo().io)).toBe(2);
    const h = fakeIo();
    expect(main(["--help"], h.io)).toBe(0);
    expect(h.out()).toContain("Usage:");
  });
});
