import { describe, expect, it } from "vitest";
import type { CaseResult, GraderResult, RunResult } from "../parser/index.ts";
import {
  DEFAULT_THRESHOLDS,
  diagnose,
  diagnoseCase,
  judgeVotes,
  type CaseVerdict,
  type FindingKind,
} from "./verdict.ts";

const run = (score: number, extra: Partial<RunResult> = {}): RunResult => ({
  score,
  error: null,
  skippedPaidGraders: false,
  ...extra,
});
const scoredGrader: GraderResult = { name: "g", passed: true, scored: true };

const caseOf = (
  withScores: readonly number[],
  withoutScores: readonly number[],
  delta: number | undefined,
  over: Partial<CaseResult> = {},
): CaseResult => ({
  name: "c",
  aggregates: delta === undefined ? {} : { delta },
  withRuns: withScores.map((s) => run(s, { graders: [scoredGrader] })),
  withoutRuns: withoutScores.map((s) => run(s, { graders: [scoredGrader] })),
  ...over,
});

const kinds = (v: CaseVerdict): readonly FindingKind[] =>
  v.findings.map((f) => f.kind);

describe("verdict categories", () => {
  it("discriminates when delta clears the noise", () => {
    const v = diagnoseCase(caseOf([1, 1, 1], [0, 0, 0], 1));
    expect(v.verdict).toBe("discriminates");
    expect(v.delta).toBe(1);
  });

  it("calls a positive delta within noise a weak signal", () => {
    // means 0.5 vs 0.25, sd 0.5 each, SE ~0.41: delta 0.25 is inside 2 SE.
    const v = diagnoseCase(caseOf([0, 1, 0.5], [0, 0.75, 0], 0.25));
    expect(v.verdict).toBe("weak-signal");
  });

  it("is no-discrimination near zero and flags a ceiling", () => {
    const v = diagnoseCase(caseOf([1, 1], [1, 1], 0));
    expect(v.verdict).toBe("no-discrimination");
    expect(kinds(v)).toContain("both-arms-pass-all");
  });

  it("flags a floor when both arms score 0", () => {
    const v = diagnoseCase(caseOf([0, 0], [0, 0], 0));
    expect(v.verdict).toBe("no-discrimination");
    expect(kinds(v)).toContain("both-arms-fail-all");
  });

  it("reports a negative delta", () => {
    const v = diagnoseCase(caseOf([0, 0], [1, 1], -1));
    expect(v.verdict).toBe("negative-delta");
    expect(kinds(v)).toContain("negative-delta");
  });

  it("treats a delta at the neutral band edge as signal, not zero", () => {
    const edge = DEFAULT_THRESHOLDS.neutralBand;
    expect(diagnoseCase(caseOf([1], [1 - edge], edge)).verdict).toBe(
      "discriminates",
    );
    expect(diagnoseCase(caseOf([1], [1 + edge], -edge)).verdict).toBe(
      "negative-delta",
    );
  });

  it("trusts a single run per arm but says noise is unknown", () => {
    const v = diagnoseCase(caseOf([1], [0.5], 0.5));
    expect(v.verdict).toBe("discriminates");
    expect(kinds(v)).toContain("single-run");
  });
});

describe("missing signal", () => {
  it("reports no delta signal, not zero, for a one-arm run", () => {
    const v = diagnoseCase(caseOf([1, 1], [], undefined));
    expect(v.verdict).toBe("no-delta-signal");
    expect(v.delta).toBeUndefined();
    expect(v.without.runs).toBe(0);
  });

  it("reports no delta signal when the arms are not comparable", () => {
    const v = diagnoseCase(caseOf([1], [0], undefined));
    expect(v.verdict).toBe("no-delta-signal");
    expect(v.delta).toBeUndefined();
  });

  it("reports no-scored-graders when every grader is excluded", () => {
    const unscored = { name: "g", scored: false };
    const v = diagnoseCase(
      caseOf([1], [0], 1, {
        withRuns: [run(1, { graders: [unscored] })],
        withoutRuns: [run(0, { graders: [unscored] })],
      }),
    );
    expect(v.verdict).toBe("no-scored-graders");
    expect(v.scoredGraders).toBe(0);
  });

  it("does not claim zero scored graders when the file has no grader detail", () => {
    const v = diagnoseCase(
      caseOf([1], [0], 1, {
        withRuns: [run(1)],
        withoutRuns: [run(0)],
      }),
    );
    expect(v.verdict).toBe("discriminates");
    expect(v.scoredGraders).toBeUndefined();
  });

  it("reports no-data without with-plugin runs", () => {
    expect(diagnoseCase(caseOf([], [], undefined)).verdict).toBe("no-data");
  });
});

describe("errors and skipped judges", () => {
  const limited = "usage limit reached";

  it("calls an all-errored arm a failed run, not a regression", () => {
    const v = diagnoseCase(
      caseOf([], [], -1, {
        withRuns: [run(0, { error: limited }), run(0, { error: limited })],
        withoutRuns: [run(1)],
      }),
    );
    expect(v.verdict).toBe("run-error");
    expect(v.delta).toBeUndefined();
    expect(v.findings.find((f) => f.kind === "run-error")?.message).toContain(
      limited,
    );
  });

  it("calls an all-errored no-plugin arm a failed run", () => {
    const v = diagnoseCase(
      caseOf([], [], 1, {
        withRuns: [run(1)],
        withoutRuns: [run(0, { error: limited })],
      }),
    );
    expect(v.verdict).toBe("run-error");
  });

  it("recomputes delta without the errored runs", () => {
    // The file's delta (-0.333) counts the 0-scored errored run as a regression.
    const v = diagnoseCase(
      caseOf([], [], -0.333, {
        withRuns: [run(1), run(1), run(0, { error: limited })],
        withoutRuns: [run(0.5), run(0.5), run(0.5)],
      }),
    );
    expect(v.verdict).toBe("discriminates");
    expect(v.delta).toBe(0.5);
    expect(v.with.usedRuns).toBe(2);
    expect(kinds(v)).toEqual(
      expect.arrayContaining(["run-error", "delta-recomputed"]),
    );
  });

  it("keeps an aborted run's 0 but notes it", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [run(1), run(0, { aborted: true })],
        withoutRuns: [run(0), run(0)],
      }),
    );
    expect(v.with.usedRuns).toBe(2);
    expect(kinds(v)).toContain("aborted");
  });

  it("leaves skipped-judge runs out and says so", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [run(1), run(0.2, { skippedPaidGraders: true })],
        withoutRuns: [run(0.5)],
      }),
    );
    expect(v.with.usedRuns).toBe(1);
    expect(v.delta).toBe(0.5);
    expect(kinds(v)).toContain("skipped-paid-graders");
  });

  it("calls an all-skipped arm judge-skipped", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [run(0.2, { skippedPaidGraders: true })],
        withoutRuns: [run(0.5)],
      }),
    );
    expect(v.verdict).toBe("judge-skipped");
  });
});

describe("mechanical findings", () => {
  const judge = (explanation: string): GraderResult => ({
    name: "asks_for_permission",
    scored: true,
    explanation,
  });

  it("flags split judge votes and names the grader, arm and run", () => {
    const v = diagnoseCase(
      caseOf([1], [0.5], 0.5, {
        withRuns: [run(1, { graders: [judge("judge votes: PASS PASS PASS")] })],
        withoutRuns: [
          run(0.5, { graders: [judge("judge votes: PASS FAIL FAIL")] }),
        ],
      }),
    );
    const f = v.findings.find((x) => x.kind === "split-judge-votes");
    expect(f?.message).toContain("asks_for_permission (without run 1");
    expect(f?.message).not.toContain("with run");
  });

  it("ignores split votes on an unscored grader", () => {
    const unscored: GraderResult = {
      name: "j",
      scored: false,
      explanation: "PASS FAIL",
    };
    const v = diagnoseCase(
      caseOf([1], [0.5], 0.5, {
        withRuns: [run(1, { graders: [scoredGrader, unscored] })],
      }),
    );
    expect(kinds(v)).not.toContain("split-judge-votes");
  });

  it("flags high variance in an arm", () => {
    const v = diagnoseCase(caseOf([1, 0, 1, 0], [0, 0, 0, 0], 0.5));
    expect(kinds(v)).toContain("high-variance");
  });

  it("flags a partial document on every case", () => {
    const d = diagnose({
      schemaVersion: 1,
      partial: true,
      partialReason: "cost ceiling",
      cases: [caseOf([1], [0], 1)],
    });
    expect(d.partial).toBe(true);
    expect(d.partialReason).toBe("cost ceiling");
    expect(d.cases.flatMap(kinds)).toContain("partial");
  });

  it("parses judge votes", () => {
    expect(judgeVotes("judge votes: PASS FAIL PASS")).toEqual([
      "PASS",
      "FAIL",
      "PASS",
    ]);
    expect(judgeVotes("regex matched")).toEqual([]);
  });
});

describe("thresholds", () => {
  it("honors a custom neutral band", () => {
    const c = caseOf([1], [0.8], 0.2);
    expect(diagnoseCase(c).verdict).toBe("discriminates");
    expect(
      diagnoseCase(c, false, { ...DEFAULT_THRESHOLDS, neutralBand: 0.3 })
        .verdict,
    ).toBe("no-discrimination");
  });
});
