/**
 * Configurable paid-run settings (#1116). Precedence, highest first:
 * CLI flag, environment variable, `<eval-dir>/run-config.json`, built-in tier value.
 * Every effective value that is not built in is reported as a note, so `--dry-run` shows its source.
 *
 * File shape (all keys optional):
 *   { "jobs": 4, "tiers": { "standard": { "maxCostUsd": 8, "runs": 4 } } }
 */
import { TIERS, isTierName, parseCost, type Tier } from "./tiers.ts";

export const CONFIG_FILE = "run-config.json";

export interface Settings {
  readonly tier: Tier;
  /** A whole-run ceiling that replaces the tier's (flag or env); undefined keeps the tier's own. */
  readonly maxCostUsd: number | undefined;
  readonly jobs: number | undefined;
  /**
   * `EVAL_AUTO_APPROVE_MAX_USD`: the user's standing go-ahead for runs whose ceiling is within it.
   * Environment only, never a flag or the file: a flag the agent passes, or a file a PR commits,
   * would let the agent approve its own spend.
   */
  readonly autoApproveUsd: number | undefined;
  /** One line per effective value that did not come from the built-in tiers. */
  readonly notes: readonly string[];
}

export type Resolved =
  | { readonly ok: true; readonly settings: Settings }
  | { readonly ok: false; readonly message: string };

const posInt = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
const posNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Apply the env and file layers under the flags. `fileText` is the file's
 * contents (undefined when absent). A bad value is an error, never ignored,
 * and every layer is checked even when a higher one overrides it: a typo must
 * not silently fall back to a different spend, or hide until the override goes.
 */
export const resolveSettings = (
  flags: { tier: Tier; maxCostUsd: number | undefined; jobs: number | undefined },
  env: Readonly<Record<string, string | undefined>>,
  fileText: string | undefined,
): Resolved => {
  let file: Record<string, unknown> = {};
  if (fileText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(fileText);
      if (!isRecord(parsed)) throw new Error("top level must be an object");
      file = parsed;
    } catch (e) {
      return { ok: false, message: `${CONFIG_FILE}: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const bad = (what: string): Resolved => ({ ok: false, message: `${CONFIG_FILE}: ${what}` });
  for (const k of Object.keys(file)) {
    if (k !== "jobs" && k !== "tiers") return bad(`'${k}' is not a setting (jobs, tiers)`);
  }

  let fileTier: { maxCostUsd?: number; runs?: number } = {};
  const tiers = file["tiers"];
  if (tiers !== undefined) {
    if (!isRecord(tiers)) return bad("'tiers' must be an object");
    for (const [name, raw] of Object.entries(tiers)) {
      if (!isTierName(name)) return bad(`unknown tier '${name}' (expected ${Object.keys(TIERS).join(", ")})`);
      if (!isRecord(raw)) return bad(`tiers.${name} must be an object`);
      for (const k of Object.keys(raw)) {
        if (k !== "maxCostUsd" && k !== "runs") return bad(`tiers.${name}.${k} is not a setting (maxCostUsd, runs)`);
      }
      const maxCostUsd = posNum(raw["maxCostUsd"]);
      const runs = posInt(raw["runs"]);
      if (raw["maxCostUsd"] !== undefined && maxCostUsd === undefined) return bad(`tiers.${name}.maxCostUsd must be a positive number`);
      if (raw["runs"] !== undefined && runs === undefined) return bad(`tiers.${name}.runs must be a positive integer`);
      if (name === flags.tier.name) {
        fileTier = { ...(maxCostUsd === undefined ? {} : { maxCostUsd }), ...(runs === undefined ? {} : { runs }) };
      }
    }
  }
  const fileJobs = posInt(file["jobs"]);
  if (file["jobs"] !== undefined && fileJobs === undefined) return bad("'jobs' must be a positive integer");

  const envCostText = env["EVAL_MAX_COST_USD"];
  const envCost = envCostText === undefined || envCostText === "" ? undefined : parseCost(envCostText);
  if (envCostText !== undefined && envCostText !== "" && envCost === undefined) {
    return { ok: false, message: `EVAL_MAX_COST_USD must be a positive number of US dollars, got '${envCostText}'` };
  }
  const envJobsText = env["EVAL_JOBS"];
  if (envJobsText !== undefined && envJobsText !== "" && !/^[1-9]\d*$/.test(envJobsText)) {
    return { ok: false, message: `EVAL_JOBS must be a positive integer, got '${envJobsText}'` };
  }
  const envJobs = envJobsText === undefined || envJobsText === "" ? undefined : Number(envJobsText);

  const approveText = env["EVAL_AUTO_APPROVE_MAX_USD"];
  const autoApproveUsd = approveText === undefined || approveText === "" ? undefined : parseCost(approveText);
  if (approveText !== undefined && approveText !== "" && autoApproveUsd === undefined) {
    return { ok: false, message: `EVAL_AUTO_APPROVE_MAX_USD must be a positive number of US dollars, got '${approveText}'` };
  }

  // Pick the winner per setting and note only what is effective and not built in.
  const notes: string[] = [];
  const name = flags.tier.name;
  let tier = flags.tier;
  if (fileTier.runs !== undefined) {
    tier = { ...tier, runs: fileTier.runs };
    notes.push(`${name} runs ${String(fileTier.runs)} from ${CONFIG_FILE}`);
  }
  let maxCostUsd = flags.maxCostUsd;
  if (maxCostUsd !== undefined) {
    notes.push(`ceiling $${String(maxCostUsd)} (whole run) from --max-cost-usd`);
  } else if (envCost !== undefined) {
    maxCostUsd = envCost;
    notes.push(`ceiling $${String(envCost)} (whole run) from EVAL_MAX_COST_USD`);
  } else if (fileTier.maxCostUsd !== undefined) {
    // A configured ceiling is a flat total, so it drops the per-case scaling.
    tier = { ...tier, maxCostUsd: fileTier.maxCostUsd, perCaseUsd: undefined };
    notes.push(`${name} ceiling $${String(fileTier.maxCostUsd)} from ${CONFIG_FILE}`);
  }
  let jobs = flags.jobs;
  if (jobs !== undefined) {
    notes.push(`jobs ${String(jobs)} from --jobs`);
  } else if (envJobs !== undefined) {
    jobs = envJobs;
    notes.push(`jobs ${String(envJobs)} from EVAL_JOBS`);
  } else if (fileJobs !== undefined) {
    jobs = fileJobs;
    notes.push(`jobs ${String(fileJobs)} from ${CONFIG_FILE}`);
  }
  return { ok: true, settings: { tier, maxCostUsd, jobs, autoApproveUsd, notes } };
};
