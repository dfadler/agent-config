import { describe, expect, it } from "vitest";
import { main, MIN_GATE_CASES } from "./check-plugin-eval.ts";
import { cliError, EXIT_FAILURE } from "./lib/exit-codes.ts";
import { err, ok } from "./lib/result.ts";

const arm = (o: object = {}) => ({
  score: 1,
  graders: [{ name: "g", passed: true }],
  error: null,
  skippedPaidGraders: false,
  ...o,
});
const result = (
  o: {
    partial?: boolean;
    delta?: number;
    withArm?: object;
    withoutArm?: object;
  } = {},
) =>
  JSON.stringify({
    schemaVersion: 1,
    partial: o.partial ?? false,
    cases: [
      {
        name: "c1",
        aggregates: o.delta === undefined ? {} : { delta: o.delta },
        arms: {
          with: [arm(o.withArm)],
          without: o.withoutArm === undefined ? [] : [arm(o.withoutArm)],
        },
      },
    ],
  });

const check = (cliExit: string, json: string, extra: string[] = []) =>
  main(
    ["--cli-exit", cliExit, "--threshold", "0.8", ...extra, "r.json"],
    {},
    { readFile: () => ok(json) },
  );

const codeOf = (r: ReturnType<typeof check>) =>
  r.tag === "ok" ? 0 : r.error.code;

describe("check-plugin-eval", () => {
  it("passes a valid run with CLI exit 0", () => {
    expect(codeOf(check("0", result({ delta: 0.3 })))).toBe(0);
  });

  it("fails a regression: valid run, CLI exit 1", () => {
    expect(codeOf(check("1", result()))).toBe(1);
  });

  it("treats CLI exit 2 as inconclusive", () => {
    expect(codeOf(check("2", result()))).toBe(7);
  });

  it.each([
    ["partial", result({ partial: true })],
    ["skippedPaidGraders", result({ withArm: { skippedPaidGraders: true } })],
    ["arm error", result({ withArm: { error: "boom" } })],
    ["without-arm error", result({ withoutArm: { error: "usage limit" } })],
    [
      "without-arm skippedPaidGraders",
      result({ withoutArm: { skippedPaidGraders: true } }),
    ],
    ["bad json", "{nope"],
  ])("treats %s as inconclusive even when the CLI failed", (_n, json) => {
    expect(codeOf(check("1", json))).toBe(7);
  });

  it("treats an unreadable file as inconclusive", () => {
    const r = main(
      ["--cli-exit", "0", "--threshold", "0.8", "r.json"],
      {},
      { readFile: () => err(cliError(EXIT_FAILURE, "cannot read r.json")) },
    );
    expect(codeOf(r)).toBe(7);
  });

  it("warns on non-positive delta without failing; missing delta is silent", () => {
    const warn = check("0", result({ delta: 0, withoutArm: {} }));
    expect(warn.tag === "ok" && warn.value).toContain("warning: c1");
    const none = check("0", result());
    expect(none.tag === "ok" && none.value).not.toContain("warning");
  });

  it("lists a case with no delta as ungated, not as a warning (#738)", () => {
    const none = check("0", result());
    expect(none.tag === "ok" && none.value).toContain("ungated by delta");
    const has = check("0", result({ delta: 0.3 }));
    expect(has.tag === "ok" && has.value).not.toContain("ungated");
  });

  it("rejects an empty or blank --cli-exit as a usage error", () => {
    expect(codeOf(check("", result()))).toBe(2);
    expect(codeOf(check("  ", result()))).toBe(2);
  });

  it("treats a result without a cases array as inconclusive, not a pass", () => {
    expect(codeOf(check("0", "{}"))).toBe(7);
    expect(codeOf(check("0", JSON.stringify({ cases: "x" })))).toBe(7);
  });

  it.each([
    ["empty cases", { schemaVersion: 1, cases: [] }],
    ["a missing schemaVersion", { cases: [{ arms: { with: [arm()] } }] }],
    [
      "a wrong schemaVersion",
      { schemaVersion: 2, cases: [{ arms: { with: [arm()] } }] },
    ],
    [
      "a case with no with-runs",
      { schemaVersion: 1, cases: [{ arms: { without: [arm()] } }] },
    ],
    [
      "a dropped case",
      { schemaVersion: 1, cases: [7, { arms: { with: [arm()] } }] },
    ],
    [
      "a dropped run",
      { schemaVersion: 1, cases: [{ arms: { with: [arm(), null] } }] },
    ],
  ])("treats %s as inconclusive, never a pass (#734)", (_n, doc) => {
    expect(codeOf(check("0", JSON.stringify(doc)))).toBe(7);
  });

  it.each([
    ["an empty-string error", { error: "" }],
    ["a score 0 with no graders", { score: 0, graders: [] }],
    ["a score 0 with graders omitted", { score: 0, graders: undefined }],
  ])("treats %s as inconclusive (#735)", (_n, withArm) => {
    expect(codeOf(check("1", result({ withArm })))).toBe(7);
  });

  it("treats an all-zero run as inconclusive, not a regression or a pass (#735)", () => {
    const zero = { score: 0, graders: [{ name: "g", passed: false }] };
    const r = result({ withArm: zero, withoutArm: zero });
    expect(codeOf(check("1", r))).toBe(7);
    expect(codeOf(check("0", r, ["--delta-floor", "0"]))).toBe(7);
  });

  it("keeps a real regression (score 0 with failing graders, without-arm passing)", () => {
    const r = result({
      withArm: { score: 0, graders: [{ name: "g", passed: false }] },
      withoutArm: {},
    });
    expect(codeOf(check("1", r))).toBe(1);
  });

  it("rejects an empty --delta-floor instead of reading it as 0", () => {
    expect(codeOf(check("0", result(), ["--delta-floor", ""]))).toBe(2);
  });

  // n cases, each with-arm 3 runs at `w` and without-arm 3 runs at `wo`.
  const manyCases = (n: number, w: number, wo: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `c${String(i)}`,
      aggregates: { delta: w - wo },
      arms: {
        with: [1, 2, 3].map(() => arm({ score: w })),
        without: [1, 2, 3].map(() => arm({ score: wo })),
      },
    }));
  const many = (n: number, w: number, wo: number) =>
    JSON.stringify({
      schemaVersion: 1,
      partial: false,
      cases: manyCases(n, w, wo),
    });
  const f = ["--delta-floor", "0.14"];

  it("--delta-floor gates a low mean delta once there are 16 cases (#736)", () => {
    expect(codeOf(check("0", many(16, 0.5, 0.4), f))).toBe(1);
    expect(codeOf(check("0", many(16, 0.6, 0.4), f))).toBe(0);
  });

  it("is advisory under 16 cases: warns, exit 0 (#736)", () => {
    const r = check("0", many(15, 0.5, 0.4), f);
    expect(codeOf(r)).toBe(0);
    expect(r.tag === "ok" ? r.value : "").toContain("advisory");
  });

  // The wrapper writes one result file per case, so the gate must pool files.
  const caseFile = (i: number, w: number, wo: number) =>
    JSON.stringify({
      schemaVersion: 1,
      partial: false,
      cases: [{ ...manyCases(1, w, wo)[0], name: `c${String(i)}` }],
    });
  const checkFiles = (
    cliExit: string,
    files: Record<string, string>,
    extra: string[] = [],
  ) =>
    main(
      ["--cli-exit", cliExit, "--threshold", "1", ...extra, ...Object.keys(files)],
      {},
      {
        readFile: (p) =>
          p in files
            ? ok(files[p] ?? "")
            : err(cliError(EXIT_FAILURE, `cannot read ${p}`)),
      },
    );
  const perCase = (n: number, w: number, wo: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`r${String(i)}.json`, caseFile(i, w, wo)]),
    );

  it("pools one-case files so the floor can fail a run (C17)", () => {
    // each file alone is under 16 cases, so a per-file call only warns
    expect(codeOf(checkFiles("0", { "r0.json": caseFile(0, 0.5, 0.4) }, f))).toBe(0);
    expect(codeOf(checkFiles("0", perCase(16, 0.5, 0.4), f))).toBe(1);
    expect(codeOf(checkFiles("0", perCase(16, 0.6, 0.4), f))).toBe(0);
  });

  it("stays advisory when the pooled run has under 16 cases", () => {
    const r = checkFiles("0", perCase(15, 0.5, 0.4), f);
    expect(codeOf(r)).toBe(0);
    expect(r.tag === "ok" ? r.value : "").toContain("advisory");
  });

  it("reports the pooled case count in the reliability line", () => {
    const r = checkFiles("0", perCase(3, 1, 0.4));
    expect(r.tag === "ok" ? r.value : "").toContain("(3 cases)");
  });

  it("makes the whole run inconclusive when one file is invalid, naming it", () => {
    const files = { ...perCase(16, 0.9, 0.4), "bad.json": result({ partial: true }) };
    const r = checkFiles("0", files, f);
    expect(codeOf(r)).toBe(7);
    expect(r.tag === "err" ? r.error.message : "").toContain("bad.json");
  });

  it("makes the run inconclusive when any file cannot be read", () => {
    const r = main(
      ["--cli-exit", "0", "--threshold", "1", "r0.json", "gone.json"],
      {},
      {
        readFile: (p) =>
          p === "r0.json" ? ok(caseFile(0, 1, 0.4)) : err(cliError(EXIT_FAILURE, "cannot read")),
      },
    );
    expect(codeOf(r)).toBe(7);
  });

  it("states the advisory case count from MIN_GATE_CASES in --help", () => {
    const h = main(["--help"], {}, { readFile: () => ok("") });
    expect(h.tag === "ok" ? h.value : "").toContain(`under ${String(MIN_GATE_CASES)} cases`);
  });

  it("does not fail a single negative case when the mean delta clears the floor", () => {
    const bad = {
      name: "neg",
      aggregates: { delta: -0.3 },
      arms: { with: [arm({ score: 0.2 })], without: [arm({ score: 0.5 })] },
    };
    const doc = {
      schemaVersion: 1,
      partial: false,
      cases: [bad, ...manyCases(15, 0.9, 0.4)],
    };
    expect(codeOf(check("0", JSON.stringify(doc), f))).toBe(0);
  });

  it("an active, met delta gate overrides CLI exit 1 (#906)", () => {
    const r = check("1", many(16, 0.6, 0.4), f);
    expect(codeOf(r)).toBe(0);
    expect(r.tag === "ok" ? r.value : "").toContain("not gated");
  });

  it("CLI exit 1 still fails when the delta gate is advisory or absent (#906)", () => {
    expect(codeOf(check("1", many(15, 0.6, 0.4), f))).toBe(1);
    expect(codeOf(check("1", many(16, 0.6, 0.4)))).toBe(1);
  });

  it("an active gate that is breached fails whatever the CLI exit (#906)", () => {
    expect(codeOf(check("1", many(16, 0.5, 0.4), f))).toBe(1);
  });

  it("reports all-runs-pass next to the mean (#736)", () => {
    const r = check("0", many(2, 1, 0.4));
    expect(r.tag === "ok" ? r.value : "").toContain("all-runs-pass 1.00");
    const m = check("0", many(2, 0.5, 0.4));
    expect(m.tag === "ok" ? m.value : "").toContain("all-runs-pass 0.00");
  });

  it("warns on a diagnose verdict, not a raw delta (#736)", () => {
    const r = check("0", many(1, 0.4, 0.4));
    expect(r.tag === "ok" ? r.value : "").toContain("no-discrimination");
  });

  it("no delta passes under the floor", () => {
    expect(codeOf(check("0", result(), f))).toBe(0);
  });

  it("an invalid run stays inconclusive under --delta-floor", () => {
    const bad = result({ partial: true, delta: -1 });
    expect(codeOf(check("0", bad, f))).toBe(7);
  });

  it("rejects a non-numeric --delta-floor", () => {
    expect(codeOf(check("0", result(), ["--delta-floor", "x"]))).toBe(2);
  });

  it("rejects bad arguments with exit 2 and prints help", () => {
    expect(codeOf(main(["r.json"], {}, { readFile: () => ok("") }))).toBe(2);
    expect(main(["--help"], {}, { readFile: () => ok("") }).tag).toBe("ok");
  });
});
