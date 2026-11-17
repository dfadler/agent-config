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
