import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheKey,
  extractEntry,
  hashTree,
  loadEntry,
  saveEntry,
  spliceResult,
  statusAfterSplice,
  type CacheEntry,
  type KeyParts,
} from "./baseline-cache.ts";
import { isRec, list, parse } from "./summary.ts";
import { at, must } from "./test-support.ts";

interface G {
  name: string;
  passed: boolean;
  weight: number;
  scored: boolean;
}
interface R {
  score: number;
  passed: boolean;
  costUsd: number;
  graders: G[];
  error?: string;
  skippedPaidGraders?: boolean;
}
interface Result {
  schemaVersion: number;
  partial: boolean;
  costUsd: number;
  suite: { threshold: number };
  cases: { name: string; arms: { with: R[]; without?: R[] }; aggregates: Record<string, unknown> }[];
  aggregates: Record<string, unknown>;
}

const grader = (name: string, passed: boolean, scored = true): G => ({ name, passed, weight: 1, scored });
const run = (graders: G[]): R => {
  const scored = graders.filter((g) => g.scored);
  const score = scored.filter((g) => g.passed).length / scored.length;
  return { score, passed: score >= 1, costUsd: 0.05, graders };
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A two-arm result for one case: `skill_fired` is with-only, so the CLI leaves it out of the score and out of the without arm. */
const twoArm = (withPass: boolean[], withoutPass: boolean[]): Result => {
  const w = withPass.map((p) => run([grader("skill_fired", true, false), grader("answers", p)]));
  const wo = withoutPass.map((p) => run([grader("answers", p)]));
  const score = mean(w.map((r) => r.score));
  const scoreWithout = mean(wo.map((r) => r.score));
  return {
    schemaVersion: 1,
    partial: false,
    costUsd: 0.3,
    suite: { threshold: 1 },
    cases: [{ name: "alpha", arms: { with: w, without: wo }, aggregates: { score, scoreWithout, delta: score - scoreWithout } }],
    aggregates: { casesTotal: 1 },
  };
};

/** What `--ablation none` hands back for the same case: the plugin arm scored on every grader, no without arm, no delta. */
const noneArm = (withPass: boolean[], skillFired = true): Result => {
  const w = withPass.map((p) => run([grader("skill_fired", skillFired), grader("answers", p)]));
  return {
    schemaVersion: 1,
    partial: false,
    costUsd: 0.15,
    suite: { threshold: 1 },
    cases: [{ name: "alpha", arms: { with: w }, aggregates: { score: mean(w.map((r) => r.score)) } }],
    aggregates: { casesTotal: 1 },
  };
};

const entryOf = (d: Result): CacheEntry => {
  const r = extractEntry(JSON.stringify(d), "alpha", "k", "2.1.0", must(d.cases[0]).arms.without?.length ?? 0, new Date("2026-11-03T00:00:00Z"));
  if (!r.ok) throw new Error(r.reason);
  return r.entry;
};

const splice = (text: Result, entry: CacheEntry): { doc: unknown; below: boolean } => {
  const r = spliceResult(JSON.stringify(text), entry);
  if (!r.ok) throw new Error(r.reason);
  return { doc: parse(r.text), below: r.belowThreshold };
};

describe("spliceResult", () => {
  it("scores the plugin arm over the graders the stored without arm lists, so a with-only grader stays out", () => {
    const entry = entryOf(twoArm([true, true, false], [false, false, true]));
    // The none-mode run fails skill_fired in one run: under none that drops the score, in a two-arm run it is excluded.
    const fresh = noneArm([true, false, true]);
    must(must(fresh.cases[0]).arms.with[0]).graders[0] = grader("skill_fired", false);
    const { doc } = splice(fresh, entry);
    expect(at(doc, "cases", 0, "arms", "with")).toMatchObject([{ score: 1 }, { score: 0 }, { score: 1 }]);
    expect(Number(at(doc, "cases", 0, "aggregates", "score"))).toBeCloseTo(2 / 3, 9);
    expect(Number(at(doc, "cases", 0, "aggregates", "scoreWithout"))).toBeCloseTo(1 / 3, 9);
    expect(Number(at(doc, "cases", 0, "aggregates", "delta"))).toBeCloseTo(1 / 3, 9);
    expect(at(doc, "cases", 0, "aggregates", "baselineCached")).toBe(true);
    expect(at(doc, "cases", 0, "arms", "with", 0, "graders")).toMatchObject([{ scored: false }, { scored: true }]);
  });

  it("recomputes pass flags and the suite totals, and records where the arm came from", () => {
    const entry = entryOf(twoArm([true, true, true], [false, false, false]));
    const { doc, below } = splice(noneArm([true, true]), entry);
    expect(at(doc, "cases", 0, "aggregates")).toMatchObject({ passRate: 1, passRateWithout: 0, delta: 1 });
    expect(at(doc, "aggregates")).toMatchObject({ casesTotal: 1, casesPassed: 1, overallScore: 1, overallPassRate: 1, meanDelta: 1 });
    expect(below).toBe(false);
    expect(at(doc, "baselineCache")).toEqual({ key: "k", case: "alpha", savedAt: "2026-11-03T00:00:00.000Z", claudeVersion: "2.1.0" });
    expect(at(doc, "costUsd")).toBe(0.15); // what this run spent, not the cached arm's cost
  });

  it("reports below-threshold from the spliced score, not from the none-mode all-graders score", () => {
    const entry = entryOf(twoArm([true, true, true], [true, true, true]));
    // skill_fired fails in the none run: none-mode would exit 1, the two-arm score ignores it.
    expect(splice(noneArm([true], false), entry).below).toBe(false);
    expect(statusAfterSplice(1, false)).toBe(0);
    expect(statusAfterSplice(0, true)).toBe(1);
    expect(statusAfterSplice(2, false)).toBe(2);
    expect(statusAfterSplice(null, false)).toBeNull();
  });

  it("refuses a stored arm that lists no graders, text that is not an object, and a case the result lacks", () => {
    const good = entryOf(twoArm([true, true, true], [true, true, true]));
    expect(spliceResult(JSON.stringify(noneArm([true])), { ...good, without: [{ score: 1, graders: [] }] }).ok).toBe(false);
    expect(spliceResult("nope", good).ok).toBe(false);
    expect(spliceResult(JSON.stringify(noneArm([true])), { ...good, caseName: "beta" })).toMatchObject({
      ok: false,
      reason: "no case named beta in the result",
    });
  });
});

describe("extractEntry", () => {
  const ok = (d: Result, runs = 3): ReturnType<typeof extractEntry> => extractEntry(JSON.stringify(d), "alpha", "k", "v", runs, new Date(0));
  const clean = (): Result => twoArm([true, true, true], [false, false, false]);
  it("keeps a clean two-arm result", () => {
    expect(ok(clean()).ok).toBe(true);
  });
  it("refuses a partial run", () => {
    expect(ok({ ...clean(), partial: true }).ok).toBe(false);
  });
  it("refuses an errored run in either arm", () => {
    const d = clean();
    must(must(d.cases[0]).arms.without?.[0]).error = "boom";
    expect(ok(d).ok).toBe(false);
  });
  it("refuses skipped paid graders", () => {
    const d = clean();
    must(must(d.cases[0]).arms.with[0]).skippedPaidGraders = true;
    expect(ok(d).ok).toBe(false);
  });
  it("refuses a result with no without arm, or one shorter than the runs asked", () => {
    const none = clean();
    delete must(none.cases[0]).arms.without;
    expect(ok(none).ok).toBe(false);
    expect(ok(twoArm([true, true, true], [false, false]))).toMatchObject({ ok: false, reason: "without arm has 2 runs, 3 asked" });
  });
});

describe("cacheKey", () => {
  const parts: KeyParts = { caseName: "alpha", caseHash: "c", sharedHash: "s", grants: ["Read", "Bash"], runs: 3, threshold: 1, model: "m", judgeModel: "j", claudeVersion: "2.1.0" };
  const k = cacheKey(parts);
  it("is stable and ignores grant order", () => {
    expect(cacheKey({ ...parts, grants: ["Bash", "Read"] })).toBe(k);
  });
  it.each<[string, Partial<KeyParts>]>([
    ["case name", { caseName: "beta" }],
    ["case content", { caseHash: "c2" }],
    ["shared mocks", { sharedHash: "s2" }],
    ["grants", { grants: ["Read"] }],
    ["runs", { runs: 5 }],
    ["threshold", { threshold: 0.5 }],
    ["model", { model: "m2" }],
    ["judge model", { judgeModel: "j2" }],
    ["CLI version", { claudeVersion: "2.2.0" }],
    ["--scaffold", { scaffold: true }],
  ])("changes with %s", (_n, change) => {
    expect(cacheKey({ ...parts, ...change })).not.toBe(k);
  });
  it("keeps existing keys valid: scaffold false or absent hashes the same", () => {
    expect(cacheKey({ ...parts, scaffold: false })).toBe(k);
  });
});

describe("hashTree, loadEntry, saveEntry", () => {
  const files = new Map<string, string>();
  const io = {
    listDir: (p: string): string[] => [...new Set([...files.keys()].filter((f) => f.startsWith(`${p}/`)).map((f) => f.slice(p.length + 1).split("/")[0] ?? ""))],
    readFile: (p: string): string | undefined => files.get(p),
    writeFile: (p: string, t: string): void => void files.set(p, t),
  };
  it("changes when a nested file changes and not when nothing does", () => {
    files.clear();
    files.set("/c/prompt.md", "a");
    files.set("/c/graders/x.yaml", "b");
    const before = hashTree(io, "/c");
    expect(hashTree(io, "/c")).toBe(before);
    files.set("/c/graders/x.yaml", "b2");
    expect(hashTree(io, "/c")).not.toBe(before);
    expect(hashTree(io, "/missing")).toBe(hashTree(io, "/also-missing"));
  });
  it("round-trips an entry and rejects a file stored under another key or not JSON", () => {
    files.clear();
    const e = entryOf(twoArm([true, true, true], [false, false, false]));
    saveEntry(io, "/cache", e);
    expect(loadEntry(io, "/cache", "k")).toEqual(e);
    expect(loadEntry(io, "/cache", "other")).toBeUndefined();
    files.set("/cache/k.json", "{not json");
    expect(loadEntry(io, "/cache", "k")).toBeUndefined();
  });
});

// The stored real results are gitignored, so this replay runs on a developer machine only, over
// this plugin's evals/results (or the directory in BASELINE_REPLAY_DIR); it is skipped where empty.
const ROOT = process.env["BASELINE_REPLAY_DIR"] ?? join(import.meta.dirname, "..", "..", "..", "evals", "results");
const stored: unknown[] = existsSync(ROOT)
  ? readdirSync(ROOT).flatMap((r) =>
      readdirSync(join(ROOT, r), { recursive: true, encoding: "utf8" })
        .filter((f) => f.endsWith("aggregate-result.json"))
        .map((f): unknown => JSON.parse(readFileSync(join(ROOT, r, f), "utf8"))),
    )
  : [];

const close = (got: unknown, want: unknown, what: string): void => {
  if (typeof want === "number") expect(typeof got === "number" ? got : Number.NaN, what).toBeCloseTo(want, 9);
  else expect(got, what).toBeUndefined();
};

describe.skipIf(stored.length === 0)("replay of stored two-arm results", () => {
  it("rebuilds the CLI's own scores, pass flags, delta and suite totals from the plugin arm plus the stored without arm", () => {
    let n = 0;
    for (const d of stored.filter(isRec)) {
      for (const c of list(d["cases"]).filter(isRec)) {
        const arms = isRec(c["arms"]) ? c["arms"] : {};
        const none = { ...d, cases: [{ ...c, arms: { with: arms["with"] }, aggregates: { score: 0 } }], aggregates: {} };
        const entry: CacheEntry = { key: "k", caseName: String(c["name"]), savedAt: "x", claudeVersion: "v", without: list(arms["without"]).filter(isRec) };
        const r = spliceResult(JSON.stringify(none), entry);
        if (!r.ok) throw new Error(`${String(c["name"])}: ${r.reason}`);
        const out = parse(r.text);
        for (const k of ["score", "passRate", "scoreWithout", "passRateWithout", "delta"]) {
          close(at(out, "cases", 0, "aggregates", k), at(c, "aggregates", k), `${String(c["name"])} ${k}`);
        }
        list(arms["with"]).forEach((run, i) => {
          close(at(out, "cases", 0, "arms", "with", i, "score"), at(run, "score"), `${String(c["name"])} run ${String(i)} score`);
          expect(at(out, "cases", 0, "arms", "with", i, "passed")).toBe(at(run, "passed"));
        });
        expect(at(out, "aggregates", "casesPassed")).toBe(at(d, "aggregates", "casesPassed"));
        close(at(out, "aggregates", "overallScore"), at(d, "aggregates", "overallScore"), "overallScore");
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});
