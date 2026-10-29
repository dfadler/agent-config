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
    // One run per arm: noise unknown, so a positive delta is capped at weak-signal.
    expect(diagnoseCase(caseOf([1], [1 - edge], edge)).verdict).toBe(
      "weak-signal",
    );
    expect(diagnoseCase(caseOf([1], [1 + edge], -edge)).verdict).toBe(
      "negative-delta",
    );
  });

  it("calls a negative delta within noise a weak signal, not negative-delta", () => {
    // means 0.6 vs 0.66, sd 0.3 each, n=3: SE ~0.245, so -0.06 is noise.
    const v = diagnoseCase(
      caseOf([0.3, 0.6, 0.9], [0.36, 0.66, 0.96], -0.06),
    );
    expect(v.verdict).toBe("weak-signal");
    expect(v.reason).toContain("negative");
    expect(kinds(v)).not.toContain("negative-delta");
  });

  it("keeps negative-delta when the drop clears the noise", () => {
    const v = diagnoseCase(caseOf([0, 0, 0.1], [1, 1, 0.9], -0.9));
    expect(v.verdict).toBe("negative-delta");
  });

  it("applies the neutral band to a delta that is exactly 0.05 after float error", () => {
    // 0.35 - 0.3 is 0.04999999999999999 in floating point.
    const dropped = (a: number, b: number): CaseResult =>
      caseOf([], [], 0.5, {
        withRuns: [run(a), run(0, { error: "rate limit" })],
        withoutRuns: [run(b)],
      });
    expect(diagnoseCase(dropped(0.35, 0.3)).verdict).toBe("weak-signal");
    expect(diagnoseCase(dropped(0.3, 0.35)).verdict).toBe("negative-delta");
  });

  it("caps a single run per arm at weak-signal and says noise is unknown", () => {
    const v = diagnoseCase(caseOf([1], [0.5], 0.5));
    expect(v.verdict).toBe("weak-signal");
    expect(kinds(v)).toContain("single-run");
  });
});

describe("calibration", () => {
  it("uses the t quantile, not 2 SE, at 3 runs", () => {
    // means 0.6 vs 0.3, sd 0.1 each, n=3: SE 0.0816, 2 SE = 0.163 < 0.3 < t(2) 4.303 * SE = 0.351.
    const v = diagnoseCase(caseOf([0.5, 0.6, 0.7], [0.2, 0.3, 0.4], 0.3));
    expect(v.verdict).toBe("weak-signal");
  });

  it("floors SE so two SD-0 arms with a small delta are not discriminates", () => {
    const v = diagnoseCase(caseOf([0.6, 0.6, 0.6], [0.5, 0.5, 0.5], 0.1));
    expect(v.verdict).toBe("weak-signal");
    expect(diagnoseCase(caseOf([1, 1, 1], [0, 0, 0], 1)).verdict).toBe(
      "discriminates",
    );
  });

  it("keeps the t cutoff at 12 runs (t(11) 2.201 x SE floor 0.05 = 0.110)", () => {
    const rep = (x: number) => Array.from({ length: 12 }, () => x);
    expect(diagnoseCase(caseOf(rep(0.605), rep(0.5), 0.105)).verdict).toBe("weak-signal");
    expect(diagnoseCase(caseOf(rep(0.62), rep(0.5), 0.12)).verdict).toBe("discriminates");
  });

  it("flags a near-ceiling pair, not only exact 1", () => {
    const v = diagnoseCase(caseOf([1, 0.9, 1], [1, 1, 0.9], 0));
    expect(kinds(v)).toContain("both-arms-pass-all");
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
        withoutRuns: [run(0.5)],
      }),
    );
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
        withRuns: [run(1), run(1), run(1), run(0, { error: limited })],
        withoutRuns: [run(0.5), run(0.5), run(0.5)],
      }),
    );
    expect(v.verdict).toBe("discriminates");
    expect(v.delta).toBe(0.5);
    expect(v.with.usedRuns).toBe(3);
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

  it.each([
    ["a score 0 with no grader detail", { graders: [] }],
    ["a score 0 with graders omitted", {}],
  ])("treats %s as a failed run, not a negative delta (#735)", (_n, over) => {
    const v = diagnoseCase(
      caseOf([], [], -1, {
        withRuns: [run(0, over), run(0, over)],
        withoutRuns: [run(1)],
      }),
    );
    expect(v.verdict).toBe("run-error");
  });

  it("treats an empty-string error as errored even with a nonzero score (#735)", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [run(0.5, { error: "" })],
        withoutRuns: [run(0.2)],
      }),
    );
    expect(v.verdict).toBe("run-error");
  });

  it("keeps a score 0 that has failing graders", () => {
    const v = diagnoseCase(caseOf([0, 0], [1, 1], -1));
    expect(v.verdict).toBe("negative-delta");
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

  it("reports no-delta-signal, not judge-skipped, for an arm whose runs only lack scores", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [{ error: null }, { error: null }],
        withoutRuns: [run(0.5)],
      }),
    );
    expect(v.verdict).toBe("no-delta-signal");
    expect(v.delta).toBeUndefined();
  });

  it("does not call a mix of skipped and score-less runs judge-skipped", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.5, {
        withRuns: [{ skippedPaidGraders: true }, { error: null }],
        withoutRuns: [run(0.5)],
      }),
    );
    expect(v.verdict).toBe("no-delta-signal");
  });

  it("words delta-recomputed as excluding unscored runs, not blaming errors", () => {
    const v = diagnoseCase(
      caseOf([], [], 0.1, {
        withRuns: [run(1), { error: null }],
        withoutRuns: [run(0.5)],
      }),
    );
    expect(v.delta).toBe(0.5);
    const f = v.findings.find((x) => x.kind === "delta-recomputed");
    expect(f?.message).toContain("without a usable score");
    expect(f?.message).not.toContain("counted errored");
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

  it("reads the structured judgeVotes array over the text (synthetic split)", () => {
    const v = diagnoseCase(
      caseOf([1], [0.5], 0.5, {
        withoutRuns: [
          run(0.5, {
            graders: [
              {
                ...judge("judge votes: PASS PASS PASS"),
                judgeVotes: [true, false, true],
              },
            ],
          }),
        ],
      }),
    );
    const f = v.findings.find((x) => x.kind === "split-judge-votes");
    expect(f?.message).toContain("PASS FAIL PASS");
  });

  it("does not split on a unanimous structured array or a quoted rubric", () => {
    const v = diagnoseCase(
      caseOf([1], [0.5], 0.5, {
        withRuns: [
          run(1, {
            graders: [
              {
                ...judge("PASS if it asks. FAIL if it acts. judge votes: PASS PASS"),
                judgeVotes: [true, true],
              },
              judge("PASS if it asks. FAIL if it acts. judge votes: PASS PASS"),
            ],
          }),
        ],
      }),
    );
    expect(kinds(v)).not.toContain("split-judge-votes");
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

  it("ignores PASS and FAIL quoted from the rubric outside the votes segment", () => {
    expect(
      judgeVotes("PASS if it asks. FAIL if it acts. judge votes: PASS PASS PASS"),
    ).toEqual(["PASS", "PASS", "PASS"]);
    expect(judgeVotes("PASS if it asks. FAIL if it acts.")).toEqual([]);
  });
});

describe("thresholds", () => {
  it("never calls a zero delta negative, even with a zero neutral band", () => {
    const t = { ...DEFAULT_THRESHOLDS, neutralBand: 0 };
    // One run per arm (noise unknown) and two runs per arm (noise known) take
    // different branches; neither may read delta 0 as below zero.
    for (const c of [caseOf([1], [1], 0), caseOf([1, 1], [1, 1], 0)]) {
      const v = diagnoseCase(c, false, t);
      expect(v.verdict).not.toBe("negative-delta");
      expect(kinds(v)).not.toContain("negative-delta");
      expect(v.reason).not.toMatch(/negative/);
    }
  });

  it("honors a custom neutral band", () => {
    const c = caseOf([1], [0.8], 0.2);
    expect(diagnoseCase(c).verdict).toBe("weak-signal");
    expect(
      diagnoseCase(c, false, { ...DEFAULT_THRESHOLDS, neutralBand: 0.3 })
        .verdict,
    ).toBe("no-discrimination");
  });
});
