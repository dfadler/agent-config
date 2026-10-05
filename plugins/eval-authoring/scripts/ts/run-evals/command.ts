/**
 * Builds the argument list for one `claude plugin ...` run. Pure: nothing here
 * spawns anything, so the command can be tested without the CLI.
 */
import { DEFAULT_JUDGE_MODEL, DEFAULT_MODEL, type Tier } from "./tiers.ts";

/** The CLI subcommand, as argv after `claude`. */
export const CLI_SUBCOMMAND: readonly string[] = ["plugin", "eval"];

/**
 * How several grant entries reach `--allow-tools`.
 *
 * - `repeated`: `--allow-tools A --allow-tools B`.
 * - `variadic`: `--allow-tools A B` (one flag, one argv token per entry).
 *
 * Entries are never comma-joined: a specifier may contain a comma (#459).
 *
 * UNCONFIRMED. The docs say a target placed after `--allow-tools` is read as
 * its value, which suggests a variadic option; a variadic option normally
 * also accumulates when repeated, so `repeated` is the choice that works under
 * both readings. Check `claude plugin eval --help` and
 * https://code.claude.com/docs/en/plugin-evals, then change
 * `ALLOW_TOOLS_SHAPE` if the CLI wants the other form.
 */
export type AllowToolsShape = "repeated" | "variadic";

export const ALLOW_TOOLS_SHAPE: AllowToolsShape = "repeated";

/** The argv fragment passing `entries` to `--allow-tools`. Empty when there are none. */
export const allowToolsArgs = (
  entries: readonly string[],
  shape: AllowToolsShape = ALLOW_TOOLS_SHAPE,
): readonly string[] =>
  entries.length === 0
    ? []
    : shape === "variadic"
      ? ["--allow-tools", ...entries]
      : entries.flatMap((e) => ["--allow-tools", e]);

/** Where the user asked for output beyond the default terminal report. */
export interface Reporting {
  /** `--json <path>`: JSON to a file. (`--json` alone silences the console, so the wrapper never uses it.) */
  readonly jsonFile: string | undefined;
  /** `--report <path>`: the HTML report. */
  readonly reportFile: string | undefined;
  /** `--output-dir`: a different results directory. */
  readonly outputDir: string | undefined;
  /** `--publish-report`. Without it the wrapper passes `--no-publish`. */
  readonly publishReport: boolean;
  /** `--keep-temp`. */
  readonly keepTemp: boolean;
}

/** Everything that decides one run's command line. */
export interface RunSpec {
  /** The plugin under test (a path). It goes first so no option reads it as a value. */
  readonly target: string;
  readonly tier: Tier;
  /** Case names. One `--case` per name. */
  readonly cases: readonly string[];
  /** The group's grant set (`grantSet` from the parser), passed as `--allow-tools`. */
  readonly grants: readonly string[];
  readonly model: string | undefined;
  readonly judgeModel: string | undefined;
  /** Overrides the tier's cost ceiling; undefined keeps the tier's. Applies to this one CLI invocation. */
  readonly maxCostUsd: number | undefined;
  /** `--eval-dir`, when the caller overrides the plugin's own eval directory. */
  readonly evalDir: string | undefined;
  /** Pass `--trust-plugin`: only for this repo's plugins (see `isRepoPlugin`). */
  readonly trustPlugin: boolean;
  readonly reporting: Reporting;
}

/** Case names the CLI would read as a glob rather than literally. */
export const hasGlobMeta = (name: string): boolean => /[*?[\]{}\\]/.test(name);

/**
 * The full argv after `claude` for one run group. Order matters: target first,
 * then the variadic-looking options (`--case`, `--allow-tools`, `--tag`), then
 * the scalar flags, then `--json <path>` last. `--scaffold` is never passed:
 * it runs author-supplied bash as the user, so it stays a manual opt-in.
 */
export const buildCliArgs = (
  spec: RunSpec,
  shape: AllowToolsShape = ALLOW_TOOLS_SHAPE,
): readonly string[] => {
  const { tier, reporting } = spec;
  return [
    ...CLI_SUBCOMMAND,
    spec.target,
    ...spec.cases.flatMap((c) => ["--case", c]),
    ...allowToolsArgs(spec.grants, shape),
    ...(tier.tag === undefined ? [] : ["--tag", tier.tag]),
    "--runs",
    String(tier.runs),
    "--max-cost-usd",
    String(spec.maxCostUsd ?? tier.maxCostUsd),
    "--threshold",
    String(tier.threshold),
    "--model",
    spec.model ?? DEFAULT_MODEL,
    "--judge-model",
    spec.judgeModel ?? DEFAULT_JUDGE_MODEL,
    ...(tier.ablation === "none" ? ["--ablation", "none"] : []),
    ...(spec.evalDir === undefined ? [] : ["--eval-dir", spec.evalDir]),
    ...(spec.trustPlugin ? ["--trust-plugin"] : []),
    reporting.publishReport ? "--publish-report" : "--no-publish",
    ...(reporting.keepTemp ? ["--keep-temp"] : []),
    ...(reporting.reportFile === undefined
      ? []
      : ["--report", reporting.reportFile]),
    ...(reporting.outputDir === undefined
      ? []
      : ["--output-dir", reporting.outputDir]),
    ...(reporting.jsonFile === undefined ? [] : ["--json", reporting.jsonFile]),
  ];
};
