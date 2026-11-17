/**
 * Configurable paid-run settings (#1116). Precedence, highest first:
 * CLI flag, environment variable, `<eval-dir>/run-config.json`, built-in tier value.
 * Every value that is not built in is reported as a note, so `--dry-run` shows its source.
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
  /** One line per value that did not come from the built-in tiers. */
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
 * contents (undefined when absent). A bad value is an error, never ignored:
 * a typo must not silently fall back to a different spend.
 */
export const resolveSettings = (
  flags: { tier: Tier; maxCostUsd: number | undefined; jobs: number | undefined },
  env: Readonly<Record<string, string | undefined>>,
  fileText: string | undefined,
): Resolved => {
  const notes: string[] = [];
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

  let tier = flags.tier;
  const tiers = file["tiers"];
  if (tiers !== undefined) {
    if (!isRecord(tiers)) return bad("'tiers' must be an object");
    for (const [name, raw] of Object.entries(tiers)) {
      if (!isTierName(name)) return bad(`unknown tier '${name}' (expected ${Object.keys(TIERS).join(", ")})`);
      if (!isRecord(raw)) return bad(`tiers.${name} must be an object`);
      for (const k of Object.keys(raw)) {
        if (k !== "maxCostUsd" && k !== "runs") return bad(`tiers.${name}.${k} is not a setting (maxCostUsd, runs)`);
      }
      if (name !== tier.name) continue;
      const maxCostUsd = posNum(raw["maxCostUsd"]);
      const runs = posInt(raw["runs"]);
      if (raw["maxCostUsd"] !== undefined && maxCostUsd === undefined) return bad(`tiers.${name}.maxCostUsd must be a positive number`);
      if (raw["runs"] !== undefined && runs === undefined) return bad(`tiers.${name}.runs must be a positive integer`);
      tier = {
        ...tier,
        // A configured ceiling is a flat total, so it drops the per-case scaling.
        ...(maxCostUsd === undefined ? {} : { maxCostUsd, perCaseUsd: undefined }),
        ...(runs === undefined ? {} : { runs }),
      };
      if (maxCostUsd !== undefined) notes.push(`${name} ceiling $${String(maxCostUsd)} from ${CONFIG_FILE}`);
      if (runs !== undefined) notes.push(`${name} runs ${String(runs)} from ${CONFIG_FILE}`);
    }
  }

  let maxCostUsd = flags.maxCostUsd;
  const envCost = env["EVAL_MAX_COST_USD"];
  if (maxCostUsd === undefined && envCost !== undefined && envCost !== "") {
    maxCostUsd = parseCost(envCost);
    if (maxCostUsd === undefined) return { ok: false, message: `EVAL_MAX_COST_USD must be a positive number of US dollars, got '${envCost}'` };
    notes.push(`ceiling $${String(maxCostUsd)} (whole run) from EVAL_MAX_COST_USD`);
  }

  let jobs = flags.jobs;
  const envJobs = env["EVAL_JOBS"];
  if (jobs === undefined && envJobs !== undefined && envJobs !== "") {
    if (!/^[1-9]\d*$/.test(envJobs)) return { ok: false, message: `EVAL_JOBS must be a positive integer, got '${envJobs}'` };
    jobs = Number(envJobs);
    notes.push(`jobs ${String(jobs)} from EVAL_JOBS`);
  }
  if (jobs === undefined && file["jobs"] !== undefined) {
    jobs = posInt(file["jobs"]);
    if (jobs === undefined) return bad("'jobs' must be a positive integer");
    notes.push(`jobs ${String(jobs)} from ${CONFIG_FILE}`);
  }
  return { ok: true, settings: { tier, maxCostUsd, jobs, notes } };
};
