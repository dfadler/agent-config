import { describe, expect, it } from "vitest";
import {
  QUICK_FLOOR_USD,
  QUICK_PER_CASE_USD,
  TIERS,
  ceilingFor,
  floor4,
  isTierName,
  parseCost,
} from "./tiers.ts";

describe("parseCost range", () => {
  it("rejects values whose printed form is not a valid argument", () => {
    for (const v of ["1000000000000000000000", "0.0000001", "0.00001", "1000000.5"]) {
      expect(parseCost(v)).toBeUndefined();
    }
    expect([parseCost("0.0001"), parseCost("5"), parseCost("1000000")]).toEqual([0.0001, 5, 1000000]);
  });
  it("round-trips every accepted value through String()", () => {
    for (const n of [0.0001, 0.5, 1.2345, 5, 999999.9999, 1000000]) {
      expect(parseCost(String(n))).toBe(n);
    }
  });
});

describe("floor4", () => {
  it("never exceeds its input, and keeps exact four-decimal amounts", () => {
    expect(floor4(1.23456)).toBe(1.2345);
    expect(floor4(1.2345)).toBe(1.2345);
    expect(floor4(0.1 + 0.2)).toBe(0.3);
    expect(floor4(5)).toBe(5);
    expect(floor4(0.00009)).toBe(0);
    expect(floor4(-0.5)).toBeLessThanOrEqual(0);
  });
});

describe("isTierName", () => {
  it("accepts the tiers and rejects inherited property names", () => {
    expect(["quick", "standard", "thorough"].every(isTierName)).toBe(true);
    for (const s of ["constructor", "toString", "__proto__", "hasOwnProperty", ""]) {
      expect(isTierName(s)).toBe(false);
    }
  });
});

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
