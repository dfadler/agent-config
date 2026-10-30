import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreement, main, parseLabels, type Io } from "./judge-agreement.ts";

const fixture = (rel: string): string =>
  readFileSync(new URL(`./fixtures/judge-run/${rel}`, import.meta.url), "utf8");

/** In-memory Io seeded with the fixture run directory under `run/`. */
const memory = (extra: Record<string, string> = {}): Io => {
  const files = new Map<string, string>([
    ["run/01-pick/aggregate-result.json", fixture("01-pick/aggregate-result.json")],
    ["run/02-fallback/aggregate-result.json", fixture("02-fallback/aggregate-result.json")],
    ["run/03-plain/aggregate-result.json", fixture("03-plain/aggregate-result.json")],
    ...Object.entries(extra),
  ]);
  return {
    readFile: (p) => files.get(p),
    findResults: (p) =>
      files.has(p) ? [p] : [...files.keys()].filter((k) => k.startsWith(`${p}/`) && k.endsWith("aggregate-result.json")).sort(),
  };
};

// Hand-derived from the fixture: judge verdicts for pick/asks are with 1-3 = T F T, without 1-2 = F T.
const LABELS = JSON.stringify(
  [
    ["with", 1, "PASS"],
    ["with", 2, "FAIL"],
    ["with", 3, "FAIL"],
    ["without", 1, "FAIL"],
    ["without", 2, "FAIL"],
  ].map(([arm, run, label]) => ({ case: "pick", grader: "asks", arm, run, label })),
);

describe("judge-agreement", () => {
  it("reports the vote split and unanimous/split share per llm grader", () => {
    const out = main(["run"], memory());
    expect(out.code).toBe(0);
    // 5 judged runs: votes PASS 3+1+2+0+3 = 9, FAIL 0+2+1+3+0 = 6; unanimous with-1, without-1, without-2.
    expect(out.stdout).toContain("- pick / asks: 5 runs, votes PASS 9 / FAIL 6, unanimous 3 (60%), split 2");
    expect(out.stdout).toContain("Note: this cannot re-run the judge");
    expect(out.stdout).not.toContain("Agreement with human labels");
  });

  it("finds judged graders in the real shape, which has no `type` field", () => {
    for (const f of ["01-pick", "02-fallback", "03-plain"]) {
      expect(fixture(`${f}/aggregate-result.json`)).not.toContain('"type"');
    }
    const out = main(["run/01-pick"], memory());
    expect(out.stdout).toContain("Judge votes (1 llm graders)");
    expect(out.stdout).not.toContain("No llm graders found");
    // A regex grader entry looks the same minus judgeVotes and "judge votes:"; it is not a judge.
    expect(main(["run/03-plain"], memory()).stdout).toContain("No llm graders found");
  });

  it("falls back to the explanation text, and notes an llm grader with no votes", () => {
    const out = main(["run"], memory());
    expect(out.stdout).toContain("- fallback / text_only: 2 runs, votes PASS 1 / FAIL 3, unanimous 1 (50%), split 1");
    expect(out.stdout).toContain("- fallback / quiet: 1 runs, votes PASS 0 / FAIL 0, unanimous 0 (n/a), split 0, 1 with no votes recorded");
  });

  it("joins labels and reports agreement, kappa, TPR and TNR", () => {
    const out = main(["--labels", "labels.json", "run"], memory({ "labels.json": LABELS }));
    expect(out.code).toBe(0);
    // Pairs (judge, human): TP 1, TN 2, FP 2, FN 0 -> po 0.6, pe 0.44, kappa 0.16/0.56 = 0.29.
    expect(out.stdout).toContain("5 labels given, 5 matched a judged run");
    expect(out.stdout).toContain("- pick / asks: 5 labelled: agreement 60%, kappa 0.29, TPR 100%, TNR 50%");
  });

  it("counts only labels that match a judged run", () => {
    const stray = JSON.stringify([
      { case: "pick", grader: "asks", arm: "with", run: 1, label: "pass" },
      { case: "pick", grader: "asks", arm: "with", run: 9, label: "FAIL" },
      { case: "pick", grader: "other", arm: "with", run: 1, label: "FAIL" },
    ]);
    const out = main(["--labels", "l.json", "run"], memory({ "l.json": stray }));
    expect(out.stdout).toContain("3 labels given, 1 matched a judged run");
    expect(out.stdout).toContain("1 labelled: agreement 100%, kappa n/a (one class only), TPR 100%, TNR n/a");
  });

  it("does not crash on a result with no llm graders or on an empty label match", () => {
    const only = memory();
    const out = main(["run/03-plain"], only);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("No llm graders found");
    expect(out.stdout).toContain("cannot re-run the judge");
    const none = main(["--labels", "l.json", "run/01-pick"], memory({ "l.json": "[]" }));
    expect(none.stdout).toContain("no label matched a judged run");
  });

  it("refuses a label that matches runs in two result files, and a result field narrows it", () => {
    const second = { "run2/01-pick/aggregate-result.json": fixture("01-pick/aggregate-result.json") };
    const one = (extra: Record<string, unknown>): string =>
      JSON.stringify([{ case: "pick", grader: "asks", arm: "with", run: 1, label: "PASS", ...extra }]);
    const ambiguous = main(["--labels", "l.json", "run/01-pick", "run2"], memory({ ...second, "l.json": one({}) }));
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain("label pick / asks / with run 1 matches 2 judged runs");
    expect(ambiguous.stderr).toContain("run2/01-pick/aggregate-result.json");
    // Without labels the same two files are fine; with "result" the label counts once.
    expect(main(["run/01-pick", "run2"], memory(second)).code).toBe(0);
    const narrowed = main(["--labels", "l.json", "run/01-pick", "run2"], memory({ ...second, "l.json": one({ result: "run2/" }) }));
    expect(narrowed.code).toBe(0);
    expect(narrowed.stdout).toContain("(1 labels given, 1 matched a judged run)");
  });

  it("leaves out graders with scored: false, like diagnose does", () => {
    const text = fixture("01-pick/aggregate-result.json").replace('"scored": true', '"scored": false');
    const out = main(["x/aggregate-result.json"], memory({ "x/aggregate-result.json": text }));
    // The first with-run's grader is gone: 4 judged runs, PASS 6 / FAIL 6, split 2, unanimous 2.
    expect(out.stdout).toContain("- pick / asks: 4 runs, votes PASS 6 / FAIL 6, unanimous 2 (50%), split 2");
  });

  it("rejects bad input with the right exit code", () => {
    expect(main([], memory()).code).toBe(2);
    expect(main(["--nope", "run"], memory()).code).toBe(2);
    expect(main(["--labels"], memory()).code).toBe(2);
    expect(main(["missing"], memory()).code).toBe(1);
    expect(main(["--labels", "gone.json", "run"], memory()).code).toBe(1);
    expect(main(["--labels", "l.json", "run"], memory({ "l.json": "{}" })).stderr).toContain("JSON array");
    expect(main(["--labels", "l.json", "run"], memory({ "l.json": '[{"case":"a"}]' })).stderr).toContain("label 1");
    expect(main(["run"], memory({ "run/bad/aggregate-result.json": "not json" })).code).toBe(1);
  });

  it("prints usage for --help and says it cannot re-judge", () => {
    const out = main(["--help"], memory());
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("CANNOT re-run the judge");
  });
});

describe("agreement", () => {
  it("computes Cohen's kappa from the 2x2 table", () => {
    // TP 40, FN 10, FP 10, TN 40 -> po 0.8, pe 0.5, kappa 0.6.
    const pairs: [boolean, boolean][] = [
      ...Array.from({ length: 40 }, (): [boolean, boolean] => [true, true]),
      ...Array.from({ length: 10 }, (): [boolean, boolean] => [false, true]),
      ...Array.from({ length: 10 }, (): [boolean, boolean] => [true, false]),
      ...Array.from({ length: 40 }, (): [boolean, boolean] => [false, false]),
    ];
    const a = agreement(pairs);
    expect(a?.kappa).toBeCloseTo(0.6, 10);
    expect(a?.agreement).toBeCloseTo(0.8, 10);
    expect(a?.tpr).toBeCloseTo(0.8, 10);
    expect(a?.tnr).toBeCloseTo(0.8, 10);
  });

  it("gives kappa 0 for chance agreement and null when one class fills both sides", () => {
    // Judge always PASS, human half PASS: po 0.5, pe 0.5 -> kappa 0.
    expect(agreement([[true, true], [true, false]])?.kappa).toBeCloseTo(0, 10);
    expect(agreement([[true, true], [true, true]])).toMatchObject({ kappa: null });
  });

  it("returns null, not NaN, for no pairs", () => {
    expect(agreement([])).toBeNull();
  });
});

describe("parseLabels", () => {
  it("accepts lower-case labels and rejects a run below 1", () => {
    expect(parseLabels('[{"case":"a","grader":"g","arm":"with","run":1,"label":"fail"}]')).toMatchObject([{ pass: false }]);
    expect(parseLabels('[{"case":"a","grader":"g","arm":"with","run":0,"label":"FAIL"}]')).toContain("label 1");
  });

  it("rejects a duplicate label, but lets a different result field tell two apart", () => {
    const l = (extra: string): string => `{"case":"a","grader":"g","arm":"with","run":1,"label":"PASS"${extra}}`;
    expect(parseLabels(`[${l("")}, ${l("")}]`)).toBe("label 2: duplicates label 1");
    expect(parseLabels(`[${l(',"result":"x"')}, ${l(',"result":"y"')}]`)).toHaveLength(2);
    expect(parseLabels(`[${l(',"result":3')}]`)).toContain("label 1");
  });

  it("does not count a duplicate toward the labels given", () => {
    const dup = JSON.stringify([
      { case: "pick", grader: "asks", arm: "with", run: 1, label: "PASS" },
      { case: "pick", grader: "asks", arm: "with", run: 1, label: "PASS" },
    ]);
    const out = main(["--labels", "l.json", "run"], memory({ "l.json": dup }));
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("label 2: duplicates label 1");
  });
});
