/**
 * Cost tiers: the wrapper's whole interface for "how much to spend". A caller
 * picks a tier; the flags behind it live here.
 */

export type TierName = "quick" | "standard" | "thorough";

/** How a tier treats the plugin-less arm. Recorded with every run (see the run summary). */
export type AblationMode = "none" | "cli-default";

export interface Tier {
  readonly name: TierName;
  readonly description: string;
  readonly runs: number;
  readonly maxCostUsd: number;
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
    maxCostUsd: 1,
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
    threshold: 1,
    ablation: "cli-default",
    tag: undefined,
  },
  thorough: {
    name: "thorough",
    description: "every case, 5 runs, the CLI's default arms",
    runs: 5,
    maxCostUsd: 15,
    threshold: 1,
    ablation: "cli-default",
    tag: undefined,
  },
};

export const DEFAULT_TIER: TierName = "standard";

export const isTierName = (s: string): s is TierName => s in TIERS;

/** Pinned so scores do not drift with a CLI default. Override with `--model` / `--judge-model`. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const DEFAULT_JUDGE_MODEL = "claude-sonnet-5-5";
