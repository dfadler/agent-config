/**
 * Cost tiers: the wrapper's whole interface for "how much to spend". A caller
 * picks a tier; the flags behind it live here.
 */

/**
 * The quick tier's ceiling scales with the cases selected:
 * max(QUICK_FLOOR_USD, QUICK_PER_CASE_USD x cases), for the whole wrapper run.
 *
 * Derivation (2026-10-05, list-price `costUsd` from logged-in runs):
 * - #450, first run: 2 cases x 1 run x 2 arms = 4 runs, $0.47 including judge
 *   calls, so about $0.12 a run. That is the high end: quick has free graders
 *   only, so no judge calls.
 * - #532 (vite), standard tier: 12 cases x 3 runs x 2 arms = 72 runs, about
 *   $2.70, so about $0.04 a run.
 * - #531 (typescript-gotchas): about $2.50, but it mixes standard and sabotage
 *   runs without a run count, so it is not used for the rate.
 * A quick case is 1 run in 1 arm, so a case costs roughly $0.04 to $0.12.
 * $0.25 is about 2x the high end and 6x the vite figure. The floor ($1, the
 * old flat ceiling) lets a small suite finish: a 1-case run at the high end
 * would use $0.12. An 8-case suite gets $2 and a 12-case suite $3, against an
 * expected $0.3 to $1.5. Revisit when a quick run reports real costs.
 */
export const QUICK_PER_CASE_USD = 0.25;
export const QUICK_FLOOR_USD = 1;

export type TierName = "quick" | "standard" | "thorough";

/** How a tier treats the plugin-less arm. Recorded with every run (see the run summary). */
export type AblationMode = "none" | "cli-default";

export interface Tier {
  readonly name: TierName;
  readonly description: string;
  readonly runs: number;
  /** The whole run's ceiling; for a tier with `perCaseUsd`, the floor of the scaled ceiling. */
  readonly maxCostUsd: number;
  /** Scales the ceiling with the number of cases selected; undefined keeps `maxCostUsd` flat. */
  readonly perCaseUsd: number | undefined;
  /** Always passed explicitly: the CLI default is 1.0. */
  readonly threshold: number;
  /** `none` runs the plugin arm only, and under it nothing is excluded from scoring. */
  readonly ablation: AblationMode;
  /** Only cases with this tag run (#473: all graders free, so no judge calls). */
  readonly tag: string | undefined;
}

export const TIERS: Readonly<Record<TierName, Tier>> = {
  quick: {
    name: "quick",
    description:
      "cases tagged `quick` (free graders only), one run, plugin arm only",
    runs: 1,
    maxCostUsd: QUICK_FLOOR_USD,
    perCaseUsd: QUICK_PER_CASE_USD,
    threshold: 1,
    ablation: "none",
    tag: "quick",
  },
  standard: {
    name: "standard",
    description:
      "every case, 3 runs, the CLI's default arms (with and without the plugin)",
    runs: 3,
    maxCostUsd: 5,
    perCaseUsd: undefined,
    threshold: 1,
    ablation: "cli-default",
    tag: undefined,
  },
  thorough: {
    name: "thorough",
    description: "every case, 5 runs, the CLI's default arms",
    runs: 5,
    maxCostUsd: 15,
    perCaseUsd: undefined,
    threshold: 1,
    ablation: "cli-default",
    tag: undefined,
  },
};

/** The whole-run ceiling and how it was derived, for the run log and `--dry-run`. */
export interface Ceiling {
  readonly usd: number;
  readonly basis: string;
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/**
 * The ceiling for a run of `cases` cases: the `--max-cost-usd` override when
 * given (always a total, never scaled), else the tier's scaled or flat value.
 */
export const ceilingFor = (
  tier: Tier,
  cases: number,
  override: number | undefined,
): Ceiling => {
  if (override !== undefined) {
    return { usd: override, basis: "--max-cost-usd override" };
  }
  if (tier.perCaseUsd === undefined) {
    return { usd: tier.maxCostUsd, basis: `${tier.name} tier flat ceiling` };
  }
  const scaled = round4(tier.perCaseUsd * cases);
  const per = `${String(cases)} case(s) x $${String(tier.perCaseUsd)} = $${String(scaled)}`;
  return scaled >= tier.maxCostUsd
    ? { usd: scaled, basis: per }
    : {
        usd: tier.maxCostUsd,
        basis: `floor $${String(tier.maxCostUsd)} (${per} is lower)`,
      };
};

export const DEFAULT_TIER: TierName = "standard";

export const isTierName = (s: string): s is TierName => s in TIERS;

/** Pinned so scores do not drift with a CLI default. Override with `--model` / `--judge-model`. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_JUDGE_MODEL = "claude-sonnet-5-5";
