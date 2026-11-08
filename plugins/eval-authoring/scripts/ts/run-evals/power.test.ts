import { describe, expect, it } from "vitest";
import { detectableLine, main, parseSd, pooledSd, smallestDetectableDelta, smallestSuiteDelta } from "./power.ts";
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

describe("smallestSuiteDelta", () => {
  it("is the t cutoff at cases x (runs - 1) df times the per-case SE over sqrt(cases), for a fixed plan", () => {
    // sd 0.25, 5 runs: per-case SE 0.1581; 3 cases: SE 0.0913, t(12) 2.179.
    expect(smallestSuiteDelta(5, 0.25, 3)).toBeCloseTo(0.1989, 3);
  });
  it("equals the per-case cutoff at one case", () => {
    expect(smallestSuiteDelta(5, 0.25, 1)).toBeCloseTo(smallestDetectableDelta(5, 0.25) ?? NaN, 6);
  });
  it("floors the per-case SE at 0.05 before dividing, so SD 0 over 4 cases is still not noise-free", () => {
    // SE 0.05 / 2 = 0.025, t(16) 2.12.
    expect(smallestSuiteDelta(5, 0, 4)).toBeCloseTo(0.053, 3);
  });
  it("is undefined below two runs or one case", () => {
    expect(smallestSuiteDelta(1, 0.25, 3)).toBeUndefined();
    expect(smallestSuiteDelta(5, 0.25, 0)).toBeUndefined();
  });
});

describe("detectableLine", () => {
  it("adds the suite-mean line only when a case count is given", () => {
    const known = { sd: 0.25, source: "--sd" };
    expect(detectableLine(5, known)).not.toContain("suite-mean");
    expect(detectableLine(5, known, 3)).toContain("smallest suite-mean delta over 3 case(s) at 5 runs: 0.20\n");
  });
});

describe("pooledSd", () => {
  it("weights each arm's variance by its degrees of freedom", () => {
    const parsed = readAggregateResult(result([1, 0.5, 0], [0.5, 0.5, 0.5]));
    if (!parsed.ok) throw new Error(parsed.reason);
    // (2 x 0.25 + 2 x 0) / 4 = 0.125 -> 0.3536.
    expect(pooledSd([parsed.result])).toBeCloseTo(0.3536, 3);
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
  it("prints the suite-mean cutoff for --cases and rejects a bad --cases with exit 2", () => {
    const out = main(["--runs", "5", "--sd", "0.25", "--cases", "3"], io({}));
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("Averaged over 3 case(s), a suite-mean delta under 0.20 cannot be told from noise");
    expect(main(["--runs", "5", "--sd", "0.25"], io({})).stdout).not.toContain("Averaged over");
    for (const bad of ["0", "2.5", "abc", "-1"]) {
      expect(main(["--runs", "5", "--sd", "0.25", "--cases", bad], io({})).code).toBe(2);
    }
    expect(main(["--runs", "5", "--sd", "0.25", "--cases"], io({})).code).toBe(2);
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

// Boundary tests (#1021): each pins a value just inside and just outside a comparison.
describe("boundaries", () => {
  it("smallestDetectableDelta and smallestSuiteDelta are defined at exactly 2 runs, undefined at 1", () => {
    expect(smallestDetectableDelta(2, 0.25)).toBeCloseTo(3.1765, 3);
    expect(smallestSuiteDelta(2, 0.25, 1)).toBeCloseTo(3.1765, 3);
    expect(smallestSuiteDelta(1, 0.25, 1)).toBeUndefined();
  });
  it("parseSd accepts 0 and 1, rejects just outside, blank and non-numeric text", () => {
    expect(parseSd("0")).toBe(0);
    expect(parseSd("1")).toBe(1);
    expect(parseSd("-0.01")).toBeUndefined();
    expect(parseSd("1.01")).toBeUndefined();
    for (const bad of ["", "  ", "abc", "NaN", "Infinity"]) expect(parseSd(bad)).toBeUndefined();
  });
  it("--runs accepts 2, rejects 1, and rejects non-integers above 2", () => {
    expect(main(["--runs", "2", "--sd", "0.25"], io({})).code).toBe(0);
    expect(main(["--runs", "1", "--sd", "0.25"], io({})).code).toBe(2);
    expect(main(["--runs", "2.5", "--sd", "0.25"], io({})).code).toBe(2);
    expect(main(["--runs", "abc", "--sd", "0.25"], io({})).code).toBe(2);
  });
  it("--cases accepts 1 and rejects 0", () => {
    expect(main(["--runs", "5", "--sd", "0.25", "--cases", "1"], io({})).stdout).toContain("Averaged over 1 case(s)");
    expect(main(["--runs", "5", "--sd", "0.25", "--cases", "0"], io({})).code).toBe(2);
  });
  it("--sd accepts 0 and 1 on the command line", () => {
    expect(main(["--runs", "5", "--sd", "0"], io({})).code).toBe(0);
    expect(main(["--runs", "5", "--sd", "1"], io({})).code).toBe(0);
  });
  it("a suite-mean cutoff of 1 or more says none, below 1 gives the number", () => {
    // 2 runs, sd 0.25, 1 case: 3.18. 5 runs, 3 cases: 0.20.
    expect(main(["--runs", "2", "--sd", "0.25", "--cases", "1"], io({})).stdout).toContain(
      "no suite-mean delta can clear the 95% bar (it would need to be 3.18)",
    );
    expect(main(["--runs", "5", "--sd", "0.25", "--cases", "3"], io({})).stdout).not.toContain("no suite-mean delta");
  });
  it("detectableLine says none for a cutoff past 1 and shows the number below it, for per-case and suite lines", () => {
    const known = { sd: 0.25, source: "--sd" };
    const high = detectableLine(2, known, 1);
    expect(high).toContain("at 2 runs: none (it would need to be 3.18)");
    expect(high).toContain("at 2 runs: none (it would need to be 3.18)\n");
    const low = detectableLine(5, known, 3);
    expect(low).toContain("at 5 runs: 0.44 (SD 0.25 from --sd)");
    expect(low).not.toContain("none");
  });
  it("detectableLine asks for an SD when none is known or runs are under 2", () => {
    expect(detectableLine(5, undefined)).toContain("needs an SD");
    expect(detectableLine(1, { sd: 0.25, source: "--sd" })).toContain("needs an SD");
  });
  it("pooledSd counts arms of exactly 2 runs, skips 1-run arms, and is undefined with none usable", () => {
    const two = readAggregateResult(result([1, 0], [0.5, 0.5]));
    if (!two.ok) throw new Error(two.reason);
    // (1 x 0.5 + 1 x 0) / 2 = 0.25 -> 0.5.
    expect(pooledSd([two.result])).toBeCloseTo(0.5, 3);
    const one = readAggregateResult(result([1], [0]));
    if (!one.ok) throw new Error(one.reason);
    expect(pooledSd([one.result])).toBeUndefined();
    expect(pooledSd([])).toBeUndefined();
  });
});
