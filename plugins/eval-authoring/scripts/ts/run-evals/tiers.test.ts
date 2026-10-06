import { describe, expect, it } from "vitest";
import {
  QUICK_FLOOR_USD,
  QUICK_PER_CASE_USD,
  TIERS,
  ceilingFor,
} from "./tiers.ts";

describe("ceilingFor", () => {
  it("scales the quick ceiling by the cases selected", () => {
    expect(ceilingFor(TIERS.quick, 8, undefined)).toEqual({
      usd: 2,
      basis: "8 case(s) x $0.25 = $2",
    });
    expect(ceilingFor(TIERS.quick, 12, undefined).usd).toBe(3);
    expect(ceilingFor(TIERS.quick, 40, undefined).usd).toBe(10);
  });
  it("never goes below the floor, so a one-case run can finish", () => {
    const one = ceilingFor(TIERS.quick, 1, undefined);
    expect(one.usd).toBe(QUICK_FLOOR_USD);
    expect(one.basis).toContain("floor $1");
    expect(ceilingFor(TIERS.quick, 4, undefined).usd).toBe(QUICK_FLOOR_USD);
    expect(ceilingFor(TIERS.quick, 5, undefined).usd).toBe(1.25);
  });
  it("derives the floor and per-case constants as documented", () => {
    expect(QUICK_PER_CASE_USD).toBe(0.25);
    expect(QUICK_FLOOR_USD).toBe(1);
  });
  it("lets the override win as a total, whatever the case count", () => {
    for (const cases of [1, 8, 12]) {
      expect(ceilingFor(TIERS.quick, cases, 7)).toEqual({
        usd: 7,
        basis: "--max-cost-usd override",
      });
    }
    expect(ceilingFor(TIERS.standard, 3, 0.5).usd).toBe(0.5);
  });
  it("keeps standard and thorough flat", () => {
    for (const cases of [1, 8, 12, 100]) {
      expect(ceilingFor(TIERS.standard, cases, undefined).usd).toBe(5);
      expect(ceilingFor(TIERS.thorough, cases, undefined).usd).toBe(15);
    }
  });
});
