import { describe, expect, it } from "vitest";
import {
  durationMinutes,
  mean,
  median,
  parseDt,
  readJson,
  spanMinutes,
  stdev,
  thirtyDaysAgo,
  unwrapList,
} from "./common.ts";
import { fakeIo } from "./test-io.ts";

describe("parseDt", () => {
  it.each([[null], [undefined], [""], ["not a date"]])("returns null for %j", (v) => {
    expect(parseDt(v)).toBeNull();
  });

  it("parses Z and offset suffixes to the same instant", () => {
    expect(parseDt("2025-01-01T10:00:00Z")?.toISOString()).toBe("2025-01-01T10:00:00.000Z");
    expect(parseDt("2025-01-01T10:00:00+02:00")?.toISOString()).toBe("2025-01-01T08:00:00.000Z");
  });
});

describe("durationMinutes / spanMinutes", () => {
  const at = (s: string): Date => new Date(s);

  it("handles cross-offset and reversed arithmetic", () => {
    expect(durationMinutes(at("2025-01-01T10:00:00Z"), at("2025-01-01T10:06:00Z"))).toBe(6);
    expect(durationMinutes(at("2025-01-01T10:00:00+02:00"), at("2025-01-01T08:30:00Z"))).toBe(30);
    expect(durationMinutes(at("2025-01-01T10:06:00Z"), at("2025-01-01T10:00:00Z"))).toBe(-6);
  });

  it("spanMinutes is null for a missing, invalid, or reversed end", () => {
    expect(spanMinutes("2025-01-01T10:00:00Z", "2025-01-01T10:06:00Z")).toBe(6);
    expect(spanMinutes(null, "2025-01-01T10:06:00Z")).toBeNull();
    expect(spanMinutes("2025-01-01T10:00:00Z", "junk")).toBeNull();
    expect(spanMinutes("2025-01-01T10:06:00Z", "2025-01-01T10:00:00Z")).toBeNull();
  });
});

it("thirtyDaysAgo formats like the created>= filter", () => {
  expect(thirtyDaysAgo(new Date("2025-03-31T12:34:56.789Z"))).toBe("2025-03-01T12:34:56Z");
  expect(thirtyDaysAgo()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

describe("stats", () => {
  it("computes mean, median (odd and even) and sample stdev", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(stdev([1])).toBe(0);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });
});

describe("unwrapList / readJson", () => {
  it("accepts a wrapped or bare list and drops non-objects", () => {
    expect(unwrapList({ jobs: [{ a: 1 }, 2] }, "jobs")).toEqual([{ a: 1 }]);
    expect(unwrapList([{ a: 1 }], "jobs")).toEqual([{ a: 1 }]);
    expect(unwrapList("nope", "jobs")).toEqual([]);
  });

  it("reads stdin when no file is given", () => {
    expect(readJson(fakeIo('{"x":1}').io)).toEqual({ x: 1 });
  });
});
