/**
 * Per-case verdict (#462): is a case useful? A case is useful when the plugin
 * raises its score (delta above zero on scored graders), so "can fail" and
 * "tells the plugin from no plugin" are one measurement. Pure functions over a
 * parsed `aggregate-result.json`; no I/O, no model calls. The #436 delta gate
 * can import `diagnose` and read `verdict`.
 */
import { isErrored, isSilentZero } from "../parser/result.ts";
import type {
  AggregateResult,
  CaseResult,
  GraderResult,
  RunResult,
} from "../parser/index.ts";

export type Verdict =
  /** Delta clearly above zero and above run-to-run noise. */
  | "discriminates"
  /** Positive delta, but within noise or below the neutral band's reach. */
  | "weak-signal"
  /** Delta near zero: the plugin and no plugin score alike. */
  | "no-discrimination"
  /** Delta clearly below zero: the plugin scores worse. */
  | "negative-delta"
  /** One arm ran, or the arms are not comparable: no delta to judge. */
  | "no-delta-signal"
  /** No grader counts toward the score. */
  | "no-scored-graders"
  /** Errored runs (a rate or usage limit) leave nothing to compare. */
  | "run-error"
  /** Skipped paid judge graders leave nothing comparable. */
  | "judge-skipped"
  /** The case has no with-plugin runs. */
  | "no-data";

export type Severity = "info" | "warn" | "error";

export type FindingKind =
  | "partial"
  | "run-error"
  | "aborted"
  | "skipped-paid-graders"
  | "negative-delta"
  | "split-judge-votes"
  | "high-variance"
  | "single-run"
  | "both-arms-pass-all"
  | "both-arms-fail-all"
  | "delta-recomputed";

export interface Finding {
  readonly kind: FindingKind;
  readonly severity: Severity;
  readonly message: string;
}

/** Score statistics over the usable runs of one arm. */
export interface ArmStats {
  /** Runs in the document for this arm. */
  readonly runs: number;
  /** Runs left after dropping errored and skipped-judge runs. */
  readonly usedRuns: number;
  readonly mean?: number;
  /** Sample standard deviation; omitted below two used runs. */
  readonly stdDev?: number;
}

export interface CaseVerdict {
  readonly name: string;
  readonly verdict: Verdict;
  readonly reason: string;
  /** Omitted when there is no delta signal; never reported as zero then. */
  readonly delta?: number;
  readonly with: ArmStats;
  readonly without: ArmStats;
  /** Graders counted toward the score; omitted when the result has no grader detail. */
  readonly scoredGraders?: number;
  readonly findings: readonly Finding[];
}

export interface Diagnosis {
  /** A partial document: leave it out of trends. */
  readonly partial: boolean;
  readonly partialReason?: string;
  readonly cases: readonly CaseVerdict[];
}

export interface Thresholds {
  /** A delta within this distance of zero is "no discrimination" (a delta below the negative of it is "negative-delta"). */
  readonly neutralBand: number;
  /** Floor on the standard error of the difference, so two arms with SD 0 are not treated as noise-free. */
  readonly seFloor: number;
  /** Arm means at or above this count as the ceiling for the both-arms-pass-all finding. */
  readonly nearCeiling: number;
  /** An arm whose run scores have a standard deviation above this is flagged as unstable. */
  readonly highVariance: number;
}

/**
 * Defaults. Scores run 0 to 1 and a three-run arm moves in steps of about
 * 0.08, so 0.05 treats a one-step wobble as zero; "not noise" means beyond
 * the two-sided 95% t quantile for the run count (`tQuantile`); a 0.25
 * standard deviation means the runs disagree by about a quarter of the range.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  neutralBand: 0.05,
  seFloor: 0.05,
  nearCeiling: 0.95,
  highVariance: 0.25,
};

/** Two-sided 95% t quantiles for 1 to 10 degrees of freedom. */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228];

/** t quantile at the smaller arm's df (conservative); 2 from 11 df up. */
const tQuantile = (w: ArmStats, wo: ArmStats): number =>
  T95[Math.min(w.usedRuns, wo.usedRuns) - 2] ?? 2;

const mean = (xs: readonly number[]): number | undefined =>
  xs.length === 0
    ? undefined
    : xs.reduce((a, b) => a + b, 0) / xs.length;

const stdDev = (xs: readonly number[]): number | undefined => {
  const m = mean(xs);
  if (m === undefined || xs.length < 2) return undefined;
  const ss = xs.reduce((a, x) => a + (x - m) ** 2, 0);
  return Math.sqrt(ss / (xs.length - 1));
};

const round = (n: number): number => Math.round(n * 1000) / 1000;
const fmt = (n: number): string => String(round(n));

/** Runs that can be compared: no error, judges not skipped, a numeric score. */
const usable = (runs: readonly RunResult[]): readonly number[] =>
  runs.flatMap((r) =>
    isErrored(r) ||
    isSilentZero(r) ||
    r.skippedPaidGraders === true ||
    r.score === undefined
      ? []
      : [r.score],
  );

const armStats = (runs: readonly RunResult[]): ArmStats => {
  const scores = usable(runs);
  const m = mean(scores);
  const sd = stdDev(scores);
  return {
    runs: runs.length,
    usedRuns: scores.length,
    ...(m === undefined ? {} : { mean: round(m) }),
    ...(sd === undefined ? {} : { stdDev: round(sd) }),
  };
};

/**
 * Graders counted toward the score, from the run with the most grader detail.
 * Undefined when no run carries a grader list.
 */
const scoredGraderCount = (c: CaseResult): number | undefined => {
  const lists = [...c.withRuns, ...c.withoutRuns].flatMap((r) =>
    r.graders === undefined ? [] : [r.graders],
  );
  const best = lists.reduce<readonly GraderResult[] | undefined>(
    (acc, l) => (acc === undefined || l.length > acc.length ? l : acc),
    undefined,
  );
  return best?.filter((g) => g.scored !== false).length;
};

/**
 * Votes in a judge's `explanation`: PASS or FAIL tokens after "judge votes:".
 * Confirmed against a real llm-graded `claude plugin eval` result (fixture
 * real-llm-graded-result.json), but only unanimous samples were seen, never a
 * real split. Graders also carry a structured `judgeVotes` boolean array,
 * which `graderVotes` prefers; this text parse is the fallback.
 */
export const judgeVotes = (explanation: string): readonly string[] =>
  // Only the line after "judge votes:"; a rubric quoted earlier says PASS/FAIL too.
  /judge votes:?([^\n]*)/i
    .exec(explanation)?.[1]
    ?.match(/\b(?:PASS|FAIL)\b/g) ?? [];

/** A grader's votes: the structured array when present, else the explanation text. */
const graderVotes = (g: GraderResult): readonly string[] =>
  g.judgeVotes !== undefined
    ? g.judgeVotes.map((v) => (v ? "PASS" : "FAIL"))
    : judgeVotes(g.explanation ?? "");

const splitVoteFindings = (c: CaseResult): readonly Finding[] => {
  const arms = [
    ["with", c.withRuns],
    ["without", c.withoutRuns],
  ] as const;
  const splits = arms.flatMap(([arm, runs]) =>
    runs.flatMap((r, i) =>
      (r.graders ?? []).flatMap((g) => {
        if (g.scored === false) return [];
        const votes = graderVotes(g);
        return votes.includes("PASS") && votes.includes("FAIL")
          ? [
              `${g.name ?? "(unnamed grader)"} (${arm} run ${String(i + 1)}: ${votes.join(" ")})`,
            ]
          : [];
      }),
    ),
  );
  return splits.length === 0
    ? []
    : [
        {
          kind: "split-judge-votes",
          severity: "warn",
          message: `split judge votes, so the rubric may be unstable: ${splits.join("; ")}`,
        },
      ];
};

const runFindings = (c: CaseResult): readonly Finding[] => {
  const arms = [
    ["with", c.withRuns],
    ["without", c.withoutRuns],
  ] as const;
  return arms.flatMap(([arm, runs]) => {
    const errors = runs.filter(isErrored);
    const aborted = runs.filter((r) => r.aborted === true).length;
    const skipped = runs.filter((r) => r.skippedPaidGraders === true).length;
    const out: readonly Finding[] = [
      ...(errors.length === 0
        ? []
        : [
            {
              kind: "run-error" as const,
              severity: "error" as const,
              message: `${String(errors.length)} of ${String(runs.length)} ${arm} runs errored (${[...new Set(errors.map((r) => r.error))].join("; ")}); a rate or usage limit scores 0 and looks like a regression, so those runs are left out`,
            },
          ]),
      ...(aborted === 0
        ? []
        : [
            {
              kind: "aborted" as const,
              severity: "info" as const,
              message: `${String(aborted)} ${arm} runs were stopped by a mock's expect (score 0, counted)`,
            },
          ]),
      ...(skipped === 0
        ? []
        : [
            {
              kind: "skipped-paid-graders" as const,
              severity: "warn" as const,
              message: `${String(skipped)} ${arm} runs skipped paid judge graders over the cost ceiling; their scores are not comparable and are left out`,
            },
          ]),
    ];
    return out;
  });
};

interface Judged {
  readonly verdict: Verdict;
  readonly reason: string;
  readonly delta?: number;
  readonly findings: readonly Finding[];
}

/** The verdict from stats alone, once errors and missing signal are ruled out. */
const judgeDelta = (
  rawDelta: number,
  w: ArmStats,
  wo: ArmStats,
  t: Thresholds,
): Judged => {
  // Float noise: 0.35 - 0.30 is 0.04999999999999999, which must count as 0.05.
  const delta = round(rawDelta);
  const d = fmt(delta);
  const seW = (w.stdDev ?? 0) ** 2 / Math.max(w.usedRuns, 1);
  const seWo = (wo.stdDev ?? 0) ** 2 / Math.max(wo.usedRuns, 1);
  const se = Math.max(Math.sqrt(seW + seWo), t.seFloor);
  const mult = tQuantile(w, wo);
  const bar = mult * se;
  const noiseKnown = w.stdDev !== undefined && wo.stdDev !== undefined;
  const ceiling =
    (w.mean ?? 0) >= t.nearCeiling && (wo.mean ?? 0) >= t.nearCeiling
      ? ([
          {
            kind: "both-arms-pass-all",
            severity: "warn",
            message:
              "both arms score 1: nothing in the case fails without the plugin, so it cannot discriminate (fine as a regression guard, say so in expected_outcome)",
          },
        ] as const)
      : [];
  const floor =
    w.mean === 0 && wo.mean === 0
      ? ([
          {
            kind: "both-arms-fail-all",
            severity: "warn",
            message:
              "both arms score 0: the case never passes, check the graders and the grant",
          },
        ] as const)
      : [];
  const extra = [...ceiling, ...floor];
  if (delta <= -t.neutralBand && noiseKnown && -delta <= bar) {
    return {
      verdict: "weak-signal",
      reason: `delta ${d} is negative but within ${fmt(mult)} standard errors (${fmt(se)}) of zero, so it may be noise`,
      findings: extra,
    };
  }
  if (delta <= -t.neutralBand) {
    return {
      verdict: "negative-delta",
      reason: `the plugin scores ${d} below no plugin`,
      findings: [
        {
          kind: "negative-delta",
          severity: "warn",
          message: `delta ${d} is negative: the plugin scored worse than no plugin`,
        },
        ...extra,
      ],
    };
  }
  if (delta < t.neutralBand) {
    return {
      verdict: "no-discrimination",
      reason: `delta ${d} is within ${fmt(t.neutralBand)} of zero: the plugin and no plugin score alike`,
      findings: extra,
    };
  }
  if (!noiseKnown) {
    return {
      verdict: "weak-signal",
      reason: `delta ${d} is above zero but an arm has under two usable runs, so noise is unknown`,
      findings: [
        {
          kind: "single-run",
          severity: "info",
          message:
            "an arm has under two usable runs, so run-to-run noise is unknown and the verdict is capped at weak-signal; rerun with more runs to confirm",
        },
        ...extra,
      ],
    };
  }
  if (delta <= bar) {
    return {
      verdict: "weak-signal",
      reason: `delta ${d} is within ${fmt(mult)} standard errors (${fmt(se)}) of zero, so it may be noise`,
      findings: extra,
    };
  }
  return {
    verdict: "discriminates",
    reason: `delta ${d} is above ${fmt(mult)} standard errors (${fmt(se)})`,
    findings: extra,
  };
};

const varianceFindings = (
  w: ArmStats,
  wo: ArmStats,
  t: Thresholds,
): readonly Finding[] =>
  (
    [
      ["with", w],
      ["without", wo],
    ] as const
  ).flatMap(([arm, s]) =>
    s.stdDev !== undefined && s.stdDev > t.highVariance
      ? [
          {
            kind: "high-variance" as const,
            severity: "warn" as const,
            message: `${arm} run scores vary (standard deviation ${fmt(s.stdDev)}): the signal is unstable`,
          },
        ]
      : [],
  );

/** Why no arm run is usable: errors take precedence over skipped judges. */
const unusable = (
  runs: readonly RunResult[],
  arm: string,
): Judged | undefined => {
  if (runs.length === 0 || usable(runs).length > 0) return undefined;
  if (runs.some((r) => isErrored(r) || isSilentZero(r))) {
    return {
      verdict: "run-error",
      reason: `no ${arm} run is usable and some errored or scored a silent 0, so this is a failed run, not a regression`,
      findings: [],
    };
  }
  // Only an explicit skip means judge-skipped; runs that merely lack a score give no signal.
  return runs.every((r) => r.skippedPaidGraders === true)
    ? {
        verdict: "judge-skipped",
        reason: `every ${arm} run skipped paid judge graders, so the scores are not comparable`,
        findings: [],
      }
    : {
        verdict: "no-delta-signal",
        reason: `no ${arm} run has a usable score, so there is no delta signal`,
        findings: [],
      };
};

const withFindings = (j: Judged, extra: readonly Finding[]): Judged => ({
  ...j,
  findings: [...extra, ...j.findings],
});

const judgeCase = (c: CaseResult, t: Thresholds): Judged => {
  const w = armStats(c.withRuns);
  const wo = armStats(c.withoutRuns);
  const scored = scoredGraderCount(c);
  const base = [...runFindings(c), ...splitVoteFindings(c)];
  const stop = (j: Judged): Judged => withFindings(j, base);

  if (c.withRuns.length === 0) {
    return {
      verdict: "no-data",
      reason: "the case has no with-plugin runs",
      findings: [],
    };
  }
  const bad = unusable(c.withRuns, "with-plugin") ?? unusable(c.withoutRuns, "no-plugin");
  if (bad !== undefined) return stop(bad);
  if (scored === 0) {
    return stop({
      verdict: "no-scored-graders",
      reason: "no grader counts toward the score, so there is no delta signal",
      findings: [],
    });
  }
  const aggregateDelta = c.aggregates.delta;
  if (aggregateDelta === undefined || c.withoutRuns.length === 0) {
    return stop({
      verdict: "no-delta-signal",
      reason:
        "no delta: one arm ran or the arms are not comparable (not the same as a delta of zero)",
      findings: [],
    });
  }
  // Errored or skipped runs score 0 in the file's own delta; recompute from the rest.
  const dropped =
    w.usedRuns < w.runs || wo.usedRuns < wo.runs;
  const delta =
    dropped && w.mean !== undefined && wo.mean !== undefined
      ? w.mean - wo.mean
      : aggregateDelta;
  const recomputed: readonly Finding[] = dropped
    ? [
        {
          kind: "delta-recomputed",
          severity: "info",
          message: `delta recomputed from usable runs (${fmt(delta)}); the file's ${fmt(aggregateDelta)} may include runs without a usable score (errored, skipped judges or no score), which are excluded`,
        },
      ]
    : [];
  const judged = judgeDelta(delta, w, wo, t);
  return {
    ...judged,
    delta: round(delta),
    findings: [
      ...base,
      ...recomputed,
      ...judged.findings,
      ...varianceFindings(w, wo, t),
    ],
  };
};

/** The per-case verdict for one case. */
export const diagnoseCase = (
  c: CaseResult,
  partial = false,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): CaseVerdict => {
  const j = judgeCase(c, thresholds);
  const partialFinding: readonly Finding[] = partial
    ? [
        {
          kind: "partial",
          severity: "warn",
          message:
            "the document is partial: leave this result out of trends",
        },
      ]
    : [];
  const scoredGraders = scoredGraderCount(c);
  return {
    name: c.name,
    verdict: j.verdict,
    reason: j.reason,
    ...(j.delta === undefined ? {} : { delta: j.delta }),
    with: armStats(c.withRuns),
    without: armStats(c.withoutRuns),
    ...(scoredGraders === undefined ? {} : { scoredGraders }),
    findings: [...partialFinding, ...j.findings],
  };
};

/** The per-case verdicts for a whole result document. */
export const diagnose = (
  result: AggregateResult,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Diagnosis => ({
  partial: result.partial,
  ...(result.partialReason === undefined
    ? {}
    : { partialReason: result.partialReason }),
  cases: result.cases.map((c) => diagnoseCase(c, result.partial, thresholds)),
});
