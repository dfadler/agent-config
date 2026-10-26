import { describe, expect, it } from "vitest";
import { envBudget, resolveLimits, split } from "./limits.ts";

const run = (args: string[], cap?: string) =>
  resolveLimits(args, { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: cap });

describe("envBudget", () => {
  it.each([
    [undefined, 20],
    ["12", 12],
    ["0", 20],
    ["-3", 20],
    ["abc", 20],
    ["", 20],
    ["9".repeat(400), 20],
  ])("%j -> %i", (value, expected) => {
    expect(envBudget(value)).toBe(expected);
  });
});

describe("split", () => {
  it("spreads the remainder over the first shares", () => {
    expect(split(7, 3)).toEqual([3, 2, 2]);
  });
  it("returns no shares for zero children", () => {
    expect(split(0, 0)).toEqual([]);
  });
});

describe("resolveLimits", () => {
  it("defaults budget to the env cap and keeps the prompt", () => {
    expect(run(["audit", "the", "repo"], "9")).toEqual({
      budget: 9,
      depth: 2,
      width: 4,
      prompt: "audit the repo",
      shares: [2, 2, 2, 2],
    });
  });

  it("falls back to 20 when the env cap is unset or invalid", () => {
    expect(run(["x"], undefined)).toMatchObject({ budget: 20 });
    expect(run(["x"], "0")).toMatchObject({ budget: 20 });
  });

  it("lets a flag beat the env cap, in both spellings", () => {
    expect(run(["--budget", "5", "x"], "9")).toMatchObject({ budget: 5, shares: [1, 1, 1, 1] });
    expect(run(["--budget=5", "x"], "9")).toMatchObject({ budget: 5 });
  });

  it("caps width at budget minus 1 and shares never exceed it", () => {
    const r = run(["--budget", "3", "--width", "4", "x"]);
    expect(r).toMatchObject({ width: 2, shares: [1, 1] });
  });

  it("spawns nothing at depth 0 or budget 1", () => {
    expect(run(["--depth", "0", "x"])).toMatchObject({ shares: [] });
    expect(run(["--budget", "1", "x"])).toMatchObject({ shares: [] });
  });

  it.each([
    [["--budget", "0", "x"], /at least 1/],
    [["--budget", "abc", "x"], /whole number/],
    [["--budget"], /whole number/],
    [["--depth", "4", "x"], /0 to 3/],
    [["--width", "0", "x"], /at least 1/],
    [["--bogus", "1", "x"], /unknown flag/],
    [["--budget", "9".repeat(400), "x"], /whole number/],
    [["--budget=3=invalid", "x"], /whole number/],
  ])("rejects %j", (args, message) => {
    const r = run(args);
    expect("error" in r ? r.error : "").toMatch(message);
  });
});
