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
  | "delta-recomputed"
  /** A run used every allowed turn, so it had no final reply to grade (#713 1d). */
  | "turn-limit"
  /** Graders that pass in every run of both arms, so they cannot discriminate (#713 1c). */
  | "vacuous-graders";

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
  /**
   * Opt-in dead zone: a delta within this distance of zero is "no discrimination"
   * and a drop at least this deep may be "negative-delta". 0 (the default) turns it
   * off, leaving the SE floor and the t cutoff to call noise.
   */
  readonly neutralBand: number;
  /** Floor on the standard error of the difference, so two arms with SD 0 are not treated as noise-free. */
  readonly seFloor: number;
  /** Arm means at or above this count as the ceiling for the both-arms-pass-all finding. */
  readonly nearCeiling: number;
  /** An arm of more than `SMALL_ARM_RUNS` usable runs whose scores have a standard deviation above this is flagged as unstable. */
  readonly highVariance: number;
  /** The same flag for an arm of `SMALL_ARM_RUNS` or fewer usable runs, whose SD is itself noisy. */
  readonly highVarianceSmallArm: number;
}

/** Arms of this many usable runs or fewer use `highVarianceSmallArm`. */
export const SMALL_ARM_RUNS = 5;

/**
 * Defaults. Scores run 0 to 1. There is no fixed neutral band: "not noise"
 * means beyond the two-sided 95% t quantile for the run count (`tQuantile`)
 * times an SE of at least 0.05. A standard deviation above 0.25 (0.35 for an
 * arm of 5 runs or fewer, where the SD is itself noisy) means the runs
 * disagree by a quarter of the range or more.
 */
export const DEFAULT_THRESHOLDS: Thresholds = {
  neutralBand: 0,
  seFloor: 0.05,
  nearCeiling: 0.95,
  highVariance: 0.25,
  highVarianceSmallArm: 0.35,
};

/** Two-sided 95% t quantiles for 1 to 30 degrees of freedom. */
const T95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179,
  2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06,
  2.056, 2.052, 2.048, 2.045, 2.042,
];

/** Two-sided 95% t quantile at `df` degrees of freedom; 2 from 31 up; undefined below 1 df (no estimate). */
export const tCutoff = (df: number): number | undefined =>
  df < 1 ? undefined : (T95[df - 1] ?? 2);

/** t quantile at the smaller arm's df (conservative); 2 when an arm has under two usable runs (the SE floor applies there). */
const tQuantile = (w: ArmStats, wo: ArmStats): number =>
  tCutoff(Math.min(w.usedRuns, wo.usedRuns) - 1) ?? 2;

/**
 * The 95% bar a delta must clear to count as more than noise: the t quantile
 * times the standard error of the difference, the SE floored (default
 * `DEFAULT_THRESHOLDS.seFloor`) so two arms with SD 0 are not noise-free.
 * `se`/`mult` are returned so a caller can print them.
 */
export const deltaBar = (
  w: ArmStats,
  wo: ArmStats,
  seFloor: number = DEFAULT_THRESHOLDS.seFloor,
): { readonly se: number; readonly mult: number; readonly bar: number } => {
  const seW = (w.stdDev ?? 0) ** 2 / Math.max(w.usedRuns, 1);
  const seWo = (wo.stdDev ?? 0) ** 2 / Math.max(wo.usedRuns, 1);
  const se = Math.max(Math.sqrt(seW + seWo), seFloor);
  const mult = tQuantile(w, wo);
  return { se, mult, bar: mult * se };
};

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

/** A run that can be compared: no error, no silent 0, judges not skipped. */
const comparable = (r: RunResult): boolean =>
  !isErrored(r) && !isSilentZero(r) && r.skippedPaidGraders !== true;

/** Scores of the comparable runs that have one. */
const usable = (runs: readonly RunResult[]): readonly number[] =>
  runs.flatMap((r) =>
    comparable(r) && r.score !== undefined ? [r.score] : [],
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

/**
 * Names of the case's guard graders: ones expected to pass in both arms, so
 * they say nothing about discrimination, and (for `last_message` ones) pass on
 * an empty reply, so they say nothing about a cut-off. A `not_contains` regex,
 * a `tool_used` with `max` 0 or 1 (`min` is not read: a `min 1 max 1` check is
 * treated as a guard too, which fits the repo's "exactly one write" uses but
 * would hide a positive "exactly once" read), a `file_exists` with
 * `exists: false`.
 */
const guardNames = (c: CaseResult): ReadonlySet<string> =>
  new Set(
    (c.graders ?? []).flatMap((g) =>
      g.name !== undefined &&
      (g.match === "not_contains" ||
        (g.type === "tool_used" && (g.max === 0 || g.max === 1)) ||
        (g.type === "file_exists" && g.exists === false))
        ? [g.name]
        : [],
    ),
  );

/**
 * Whether a run at the turn limit was cut off before its reply (#713 1d):
 * true when every non-guard grader that reads `last_message` failed, false
 * when one passed (the run replied on its last turn), undefined when the data
 * cannot say (no grader definitions, no such grader scored the run, or none
 * passed but one has no `passed` value).
 */
const cutOff = (c: CaseResult, r: RunResult): boolean | undefined => {
  if (c.graders === undefined) return undefined;
  const guards = guardNames(c);
  const lastMessage = new Set(
    c.graders.flatMap((g) =>
      g.target?.kind === "last_message" &&
      g.name !== undefined &&
      !guards.has(g.name)
        ? [g.name]
        : [],
    ),
  );
  const results = (r.graders ?? []).filter(
    (g) => g.name !== undefined && lastMessage.has(g.name),
  );
  if (results.length === 0) return undefined;
  if (results.some((g) => g.passed === true)) return false;
  return results.every((g) => g.passed === false) ? true : undefined;
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
    // Errored runs are run-error, never turn-limit as well.
    const atLimit = runs.filter(
      (r) =>
        !isErrored(r) &&
        c.maxTurns !== undefined &&
        r.turns !== undefined &&
        r.turns >= c.maxTurns,
    );
    const starved = atLimit.filter((r) => cutOff(c, r) === true).length;
    const maybeStarved = atLimit.filter(
      (r) => cutOff(c, r) === undefined,
    ).length;
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
      ...(starved === 0
        ? []
        : [
            {
              kind: "turn-limit" as const,
              severity: "warn" as const,
              message: `${String(starved)} of ${String(runs.length)} ${arm} runs hit the turn limit (max_turns ${String(c.maxTurns)}) with every non-guard last_message grader failing, consistent with a cut-off: a cut-off run has no final reply, so those graders fail for the wrong reason (the score is still counted); raise max_turns or trim the work before judging the case`,
            },
          ]),
      ...(maybeStarved === 0
        ? []
        : [
            {
              kind: "turn-limit" as const,
              severity: "info" as const,
              message: `${String(maybeStarved)} of ${String(runs.length)} ${arm} runs used every allowed turn (max_turns ${String(c.maxTurns)}), but no last_message grader result can tell a cut-off from a reply: the run may simply have replied on its last turn`,
            },
          ]),
    ];
    return out;
  });
};

/**
 * Graders that pass in every usable run of both arms cannot tell the plugin
 * from no plugin (#713 1c): "did not read X" when the baseline has no X, or a
 * phrase the prompt itself contains. Needs grader detail in both arms.
 * With-only graders are absent from the no-plugin score by design and are
 * skipped, as are graders excluded from the score in every run, and guards
 * (`guardNames`, expected to pass in both arms). Without the case's grader
 * definitions a guard cannot be told apart, so the finding is info.
 */
const vacuousGraderFindings = (c: CaseResult): readonly Finding[] => {
  const graded = (
    runs: readonly RunResult[],
  ): readonly (readonly GraderResult[])[] =>
    runs.flatMap((r) =>
      r.graders === undefined || !comparable(r) ? [] : [r.graders],
    );
  const w = graded(c.withRuns);
  const wo = graded(c.withoutRuns);
  if (w.length === 0 || wo.length === 0) return [];
  const guards = guardNames(c);
  const all = [...w, ...wo].flat();
  const names = [
    ...new Set(all.flatMap((g) => (g.name === undefined ? [] : [g.name]))),
  ];
  const has = (lists: readonly (readonly GraderResult[])[], name: string): number =>
    lists.filter((l) => l.some((g) => g.name === name)).length;
  const vacuous = names.filter((name) => {
    const entries = all.filter((g) => g.name === name);
    return (
      !guards.has(name) &&
      has(w, name) > 0 &&
      has(wo, name) > 0 &&
      entries.every((g) => g.withOnly !== true && g.passed === true) &&
      entries.some((g) => g.scored !== false)
    );
  });
  const known = c.graders !== undefined;
  return vacuous.length === 0
    ? []
    : [
        {
          kind: "vacuous-graders",
          severity: known ? "warn" : "info",
          message: `graders pass in every run of both arms, so they cannot discriminate (a check the baseline satisfies trivially, or a negative pattern the prompt itself contains; a guard (not_contains, tool_used max 0 or 1, file_exists exists false) is expected to pass in both arms; otherwise reword; a should-not-fire case is the exception)${known ? "" : "; the result carries no grader definitions, so a guard cannot be told apart"}: ${vacuous
            .map(
              (name) =>
                `${name} (with ${String(has(w, name))}/${String(w.length)}, without ${String(has(wo, name))}/${String(wo.length)})`,
            )
            .join("; ")}`,
        },
      ];
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
  const { se, mult, bar } = deltaBar(w, wo, t.seFloor);
  const noiseKnown = w.stdDev !== undefined && wo.stdDev !== undefined;
  const ceiling =
    (w.mean ?? 0) >= t.nearCeiling && (wo.mean ?? 0) >= t.nearCeiling
      ? ([
          {
            kind: "both-arms-pass-all",
            severity: "warn",
            message:
              `both arms score at the ceiling (mean >= ${fmt(t.nearCeiling)}): almost nothing fails without the plugin, so the case cannot discriminate: check for a leaked answer, then fix or drop it (a should-not-fire case is the exception: delta 0 is by design, say so in expected_outcome)`,
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
  const singleRun = {
    kind: "single-run",
    severity: "info",
    message:
      "an arm has under two usable runs, so run-to-run noise is unknown and the verdict is capped at weak-signal; rerun with more runs to confirm",
  } as const;
  if (delta < 0 && delta <= -t.neutralBand && -delta <= bar) {
    return {
      verdict: "weak-signal",
      reason: `delta ${d} is negative but within ${fmt(mult)} standard errors (${fmt(se)}) of zero, so it may be noise`,
      findings: noiseKnown ? extra : [singleRun, ...extra],
    };
  }
  if (delta < 0 && delta <= -t.neutralBand) {
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
  if (delta === 0 || delta < t.neutralBand) {
    return {
      verdict: "no-discrimination",
      reason:
        delta === 0
          ? "delta is 0: the plugin and no plugin score alike"
          : `delta ${d} is within ${fmt(t.neutralBand)} of zero: the plugin and no plugin score alike`,
      findings: extra,
    };
  }
  if (!noiseKnown) {
    return {
      verdict: "weak-signal",
      reason: `delta ${d} is above zero but an arm has under two usable runs, so noise is unknown`,
      findings: [
        singleRun,
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
    s.stdDev !== undefined &&
    s.stdDev >
      (s.usedRuns <= SMALL_ARM_RUNS ? t.highVarianceSmallArm : t.highVariance)
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
  const base = [
    ...runFindings(c),
    ...splitVoteFindings(c),
    ...vacuousGraderFindings(c),
  ];
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
