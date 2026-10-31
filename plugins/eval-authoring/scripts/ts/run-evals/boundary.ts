/**
 * `--trigger-boundary`: the suite of should-not-fire prompts, each paired with
 * a should-fire twin, scored as a fire count with a Wilson bound instead of a
 * delta. In a two-arm run a must-not-fire grader passes the no-plugin arm by
 * construction, so all of its information is the plugin-arm fire count; one run
 * per distinct prompt samples the trigger boundary, repeats of one prompt do not.
 * Design and the arithmetic: the "Score negatives as a fire rate, not a delta" report
 * linked from the PR that added this file.
 *
 * Convention (parser/boundary.ts): a negative carries the tag `trigger-boundary`
 * and one `pair:<case>` tag naming a case with a must-fire Skill or Agent check.
 */
import {
  isBoundaryCase,
  isMustFire,
  isMustNotFire,
  pairTags,
  type EvalCase,
  type EvalSuite,
} from "../parser/index.ts";
import { armTally } from "./trigger.ts";

/**
 * Upper end of the Wilson score interval for `k` fires in `n` trials, at `z`
 * standard errors (1.96 is two-sided 95%):
 *   (p + z^2/2n + z * sqrt(p(1-p)/n + z^2/4n^2)) / (1 + z^2/n),  p = k/n.
 * Unlike the rule of three it is defined at k = 0 and is honest at small n:
 * 0 fires in 3 trials leaves 0.561, in 30 trials 0.114. Undefined for n = 0.
 */
export const wilsonUpper = (k: number, n: number, z: number = 1.96): number | undefined => {
  if (n <= 0) return undefined;
  const p = k / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
};

export type BoundaryPlan =
  | { readonly ok: true; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The cases a boundary run executes, in suite order: every `trigger-boundary`
 * negative and each twin its `pair:` tag names. A negative with no `pair:` tag,
 * or one naming a case the suite lacks, fails the plan rather than run unpaired
 * (an unpaired negative could not be told from a harness that never fires).
 */
export const boundaryPlan = (suite: EvalSuite): BoundaryPlan => {
  const negatives = suite.cases.filter(isBoundaryCase);
  if (negatives.length === 0) {
    return { ok: false, reason: `--trigger-boundary: no case tagged 'trigger-boundary' under ${suite.evalDir}` };
  }
  const known = new Set(suite.cases.map((c) => c.name.value));
  const problems = negatives.flatMap((c) => {
    const twins = pairTags(c);
    return twins.length === 0
      ? [`case '${c.name.value}' has no 'pair:<case>' tag`]
      : twins.filter((t) => !known.has(t)).map((t) => `case '${c.name.value}' names pair '${t}', which is not a case in the suite`);
  });
  if (problems.length > 0) return { ok: false, reason: `--trigger-boundary: ${problems.join("; ")}` };
  const wanted = new Set([...negatives.map((c) => c.name.value), ...negatives.flatMap(pairTags)]);
  return { ok: true, names: suite.cases.map((c) => c.name.value).filter((n) => wanted.has(n)) };
};

export interface BoundaryRow {
  readonly caseName: string;
  readonly twin: string | undefined;
  /** The skill or agent fired in the (single) run; undefined when no run gave a verdict. */
  readonly fired: boolean | undefined;
  /** The twin fired; undefined when it gave no verdict. */
  readonly twinFired: boolean | undefined;
}

export interface BoundaryReport {
  readonly rows: readonly BoundaryRow[];
  /** Negatives with a usable verdict. */
  readonly negatives: number;
  readonly fires: number;
  readonly twinsRun: number;
  readonly twinsFired: number;
  /** Wilson 95% upper bound on the over-trigger rate; undefined when `withheld`. */
  readonly upper: number | undefined;
  /** Why the bound is not reported (the vacuity control failed); undefined when it is. */
  readonly withheld: string | undefined;
}

type Result = { readonly caseName: string; readonly text: string | undefined };

/** Usable runs and passes of the named graders of `c` that `pick` selects, in the plugin arm of `results`. */
const verdict = (
  c: EvalCase | undefined,
  results: readonly Result[],
  pick: (g: EvalCase["graders"][number]) => boolean,
): { readonly runs: number; readonly passed: number } => {
  const text = results.find((r) => r.caseName === c?.name.value)?.text;
  return (c?.graders ?? [])
    .filter(pick)
    .flatMap((g) => (g.name.value === undefined ? [] : [armTally(text, c?.name.value ?? "", g.name.value)]))
    .reduce((a, t) => ({ runs: a.runs + t.runs, passed: a.passed + t.passed }), { runs: 0, passed: 0 });
};

/**
 * Fire count, Wilson bound and vacuity control of a boundary run. A negative
 * fired when a must-not-fire grader failed in a usable run; a twin fired when a
 * must-fire grader passed. The bound is withheld unless at least one twin fired
 * in this same run: a suite of clean negatives from a harness that cannot see
 * invocation looks identical to a well-scoped description.
 */
export const boundaryReport = (suite: EvalSuite, results: readonly Result[]): BoundaryReport => {
  const byName = (n: string | undefined): EvalCase | undefined => suite.cases.find((c) => c.name.value === n);
  const twinVerdict = (n: string): boolean | undefined => {
    const v = verdict(byName(n), results, isMustFire);
    return v.runs === 0 ? undefined : v.passed > 0;
  };
  const rows = suite.cases.filter(isBoundaryCase).map((c): BoundaryRow => {
    const v = verdict(c, results, isMustNotFire);
    const twin = pairTags(c)[0];
    return {
      caseName: c.name.value,
      twin,
      fired: v.runs === 0 ? undefined : v.passed < v.runs,
      twinFired: twin === undefined ? undefined : twinVerdict(twin),
    };
  });
  const negatives = rows.filter((r) => r.fired !== undefined).length;
  const fires = rows.filter((r) => r.fired === true).length;
  const twins = [...new Set(rows.flatMap((r) => (r.twin === undefined ? [] : [r.twin])))];
  const twinsRun = twins.filter((t) => twinVerdict(t) !== undefined).length;
  const twinsFired = twins.filter((t) => twinVerdict(t) === true).length;
  const withheld =
    negatives === 0
      ? "no negative gave a usable run (errored or skipped runs are not counted)"
      : twinsFired === 0
        ? "no should-fire twin fired in this run, so a clean count cannot be told from a harness that never sees an invocation"
        : undefined;
  return {
    rows,
    negatives,
    fires,
    twinsRun,
    twinsFired,
    upper: withheld === undefined ? wilsonUpper(fires, negatives) : undefined,
    withheld,
  };
};
