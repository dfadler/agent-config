import { describe, expect, it } from "vitest";
import { resolveSettings } from "./config.ts";
import { TIERS } from "./tiers.ts";

const flags = { tier: TIERS.standard, maxCostUsd: undefined, jobs: undefined };
const file = JSON.stringify({ jobs: 2, tiers: { standard: { maxCostUsd: 8, runs: 4 } } });

const ok = (r: ReturnType<typeof resolveSettings>) => {
  if (!r.ok) throw new Error(r.message);
  return r.settings;
};

describe("resolveSettings", () => {
  it("keeps the built-in tier with no env or file", () => {
    const s = ok(resolveSettings(flags, {}, undefined));
    expect(s.tier).toEqual(TIERS.standard);
    expect(s.notes).toEqual([]);
  });
  it("reads tier ceiling, runs and jobs from the file, naming the source", () => {
    const s = ok(resolveSettings(flags, {}, file));
    expect([s.tier.maxCostUsd, s.tier.runs, s.jobs]).toEqual([8, 4, 2]);
    expect(s.notes.join("\n")).toContain("run-config.json");
  });
  it("lets env beat the file, and a flag beat env", () => {
    const env = { EVAL_MAX_COST_USD: "3", EVAL_JOBS: "6" };
    const fromEnv = ok(resolveSettings(flags, env, file));
    expect([fromEnv.maxCostUsd, fromEnv.jobs]).toEqual([3, 6]);
    const fromFlag = ok(resolveSettings({ ...flags, maxCostUsd: 1, jobs: 8 }, env, file));
    expect([fromFlag.maxCostUsd, fromFlag.jobs]).toEqual([1, 8]);
  });
  it("applies only the selected tier's entry and drops per-case scaling", () => {
    const quick = ok(
      resolveSettings({ ...flags, tier: TIERS.quick }, {}, JSON.stringify({ tiers: { quick: { maxCostUsd: 2 }, standard: { runs: 9 } } })),
    );
    expect([quick.tier.maxCostUsd, quick.tier.perCaseUsd, quick.tier.runs]).toEqual([2, undefined, 1]);
  });
  it("rejects an unknown top-level key but keeps {} valid", () => {
    expect(resolveSettings(flags, {}, JSON.stringify({ maxCostUsd: 1 })).ok).toBe(false);
    expect(resolveSettings(flags, {}, "{}").ok).toBe(true);
  });
  it("rejects an inherited property name as a tier", () => {
    const text = JSON.stringify({ tiers: { constructor: { maxCostUsd: 1 } } });
    expect(resolveSettings(flags, {}, text).ok).toBe(false);
  });
  it("validates a tier that is not selected", () => {
    const text = JSON.stringify({ tiers: { quick: { runs: 0 } } });
    expect(resolveSettings(flags, {}, text).ok).toBe(false);
  });
  it("validates a lower layer even when a higher one overrides it", () => {
    const text = JSON.stringify({ jobs: 0 });
    expect(resolveSettings({ ...flags, jobs: 3 }, {}, text).ok).toBe(false);
    expect(resolveSettings({ ...flags, maxCostUsd: 2 }, { EVAL_MAX_COST_USD: "abc" }, undefined).ok).toBe(false);
  });
  it("notes only the effective source of each setting", () => {
    const env = { EVAL_MAX_COST_USD: "3" };
    const overridden = ok(resolveSettings(flags, env, file)).notes.join("\n");
    expect(overridden).toContain("EVAL_MAX_COST_USD");
    expect(overridden).not.toContain("ceiling $8");
    expect(overridden).toContain("standard runs 4 from run-config.json");
    const flagged = ok(resolveSettings({ ...flags, maxCostUsd: 2 }, env, file)).notes.join("\n");
    expect(flagged).toContain("ceiling $2 (whole run) from --max-cost-usd");
    expect(flagged).not.toContain("EVAL_MAX_COST_USD");
  });
  it("notes explicit flags, and nothing for built-in values", () => {
    const s = ok(resolveSettings({ ...flags, maxCostUsd: 2, jobs: 4 }, {}, undefined));
    expect(s.notes).toEqual(["ceiling $2 (whole run) from --max-cost-usd", "jobs 4 from --jobs"]);
    expect(ok(resolveSettings(flags, {}, undefined)).notes).toEqual([]);
  });
  it("reads the pre-approval cap from the environment only", () => {
    expect(ok(resolveSettings(flags, { EVAL_AUTO_APPROVE_MAX_USD: "7.5" }, undefined)).autoApproveUsd).toBe(7.5);
    expect(ok(resolveSettings(flags, {}, undefined)).autoApproveUsd).toBeUndefined();
    // A committed file cannot grant it: the key is not a setting.
    expect(resolveSettings(flags, {}, JSON.stringify({ autoApproveUsd: 99 })).ok).toBe(false);
  });
  it("rejects a bad pre-approval cap", () => {
    for (const v of ["abc", "0", "-1", "1e3"]) {
      expect(resolveSettings(flags, { EVAL_AUTO_APPROVE_MAX_USD: v }, undefined).ok).toBe(false);
    }
  });
  it("rejects bad values instead of falling back", () => {
    const bad = (env: Record<string, string>, text?: string) => resolveSettings(flags, env, text).ok;
    expect(bad({ EVAL_MAX_COST_USD: "abc" })).toBe(false);
    expect(bad({ EVAL_JOBS: "0" })).toBe(false);
    expect(bad({}, "{not json")).toBe(false);
    expect(bad({}, JSON.stringify({ tiers: { weekly: {} } }))).toBe(false);
    expect(bad({}, JSON.stringify({ tiers: { standard: { runs: 1.5 } } }))).toBe(false);
    expect(bad({}, JSON.stringify({ tiers: { standard: { cost: 1 } } }))).toBe(false);
  });
});
