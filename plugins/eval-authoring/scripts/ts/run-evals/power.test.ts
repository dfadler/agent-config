import { describe, expect, it } from "vitest";
import { main, pooledSd, smallestDetectableDelta } from "./power.ts";
import { readAggregateResult } from "../parser/index.ts";
import { tCutoff } from "../diagnose/verdict.ts";

const grader = [{ name: "g", passed: true, weight: 1, scored: true }];
const arm = (scores: readonly number[]) => scores.map((score) => ({ score, error: null, graders: grader }));
const result = (withS: readonly number[], withoutS: readonly number[]): string =>
  JSON.stringify({
    schemaVersion: 1,
    partial: false,
    cases: [{ name: "c", aggregates: { delta: 0.1 }, arms: { with: arm(withS), without: arm(withoutS) } }],
  });
const io = (files: Record<string, string>) => ({ readFile: (p: string) => files[p] });

describe("smallestDetectableDelta", () => {
  it("is the t cutoff times the SE of the difference for a fixed plan", () => {
    // sd 0.25, 3 runs: SE 0.25 x sqrt(2/3) = 0.2041, t(2) 4.303.
    expect(smallestDetectableDelta(3, 0.25)).toBeCloseTo(0.8783, 3);
    // 5 runs: SE 0.1581, t(4) 2.776.
    expect(smallestDetectableDelta(5, 0.25)).toBeCloseTo(0.4389, 3);
  });
  it("floors the SE at 0.05 so SD 0 is not noise-free", () => {
    expect(smallestDetectableDelta(5, 0)).toBeCloseTo(0.1388, 3);
  });
  it("is undefined below two runs", () => {
    expect(smallestDetectableDelta(1, 0.25)).toBeUndefined();
  });
});

describe("pooledSd", () => {
  it("weights each arm's variance by its degrees of freedom", () => {
    const parsed = readAggregateResult(result([1, 0.5, 0], [0.5, 0.5, 0.5]));
    if (!parsed.ok) throw new Error(parsed.reason);
    // (2 x 0.25 + 2 x 0) / 4 = 0.125 -> 0.3536.
    expect(pooledSd(parsed.result)).toBeCloseTo(0.3536, 3);
  });
});

describe("main", () => {
  it("prints the detectable delta for --runs and --sd", () => {
    const out = main(["--runs", "3", "--sd", "0.25"], io({}));
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("under 0.88");
  });
  it("takes the SD from a result with --from-result", () => {
    const out = main(["--runs", "5", "--from-result", "r.json"], io({ "r.json": result([1, 0.5, 0], [0.5, 0.5, 0.5]) }));
    expect(out.stdout).toContain("SD of 0.35");
    expect(out.stdout).toContain("under 0.62");
  });
  it("rejects bad input with exit 2 and an unreadable or SD-less result with exit 1", () => {
    expect(main(["--runs", "1", "--sd", "0.2"], io({})).code).toBe(2);
    expect(main(["--runs", "3"], io({})).code).toBe(2);
    expect(main(["--runs", "3", "--sd", "2"], io({})).code).toBe(2);
    expect(main(["--runs", "3", "--sd", "0.2", "--from-result", "r.json"], io({})).code).toBe(2);
    expect(main(["--runs", "3", "--from-result", "nope.json"], io({})).code).toBe(1);
    expect(main(["--runs", "3", "--from-result", "r.json"], io({ "r.json": result([1], [0]) })).code).toBe(1);
  });
  it("says no delta can clear the bar when the cutoff is 1 or more, still exit 0", () => {
    // 2 runs, sd 0.25: t(1) 12.706 x SE 0.25 = 3.18, past the 0-to-1 score range.
    const out = main(["--runs", "2", "--sd", "0.25"], io({}));
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("no delta can clear the 95% bar at 2 runs per arm");
    expect(out.stdout).not.toContain("cannot show a delta under");
  });
  it("states on the output line that a delta of that size clears the bar about half the time", () => {
    expect(main(["--runs", "5", "--sd", "0.25"], io({})).stdout).toContain("clears it about half the time");
  });
  it("treats a flag with no value as a usage error, even --from-result last", () => {
    expect(main(["--runs", "3", "--from-result"], io({})).code).toBe(2);
    expect(main(["--runs", "3", "--sd"], io({})).code).toBe(2);
    expect(main(["--runs", "--sd", "0.2"], io({})).code).toBe(2);
  });
  it("tCutoff has no estimate below 1 degree of freedom and keeps t(1) and the 2 from 31", () => {
    expect(tCutoff(0)).toBeUndefined();
    expect(tCutoff(1)).toBe(12.706);
    expect(tCutoff(31)).toBe(2);
  });
  it("prints usage for --help", () => {
    expect(main(["--help"], io({})).stdout).toContain("Usage: power.ts");
  });
});
