import { describe, expect, it } from "vitest";
import { main } from "./check-plugin-eval.ts";
import { cliError, EXIT_FAILURE } from "./lib/exit-codes.ts";
import { err, ok } from "./lib/result.ts";

const arm = (o: object = {}) => ({
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
    const warn = check("0", result({ delta: 0 }));
    expect(warn.tag === "ok" && warn.value).toContain("warning: c1");
    const none = check("0", result());
    expect(none.tag === "ok" && none.value).not.toContain("warning");
  });

  it("rejects an empty or blank --cli-exit as a usage error", () => {
    expect(codeOf(check("", result()))).toBe(2);
    expect(codeOf(check("  ", result()))).toBe(2);
  });

  it("treats a result without a cases array as inconclusive, not a pass", () => {
    expect(codeOf(check("0", "{}"))).toBe(7);
    expect(codeOf(check("0", JSON.stringify({ cases: "x" })))).toBe(7);
    expect(codeOf(check("0", JSON.stringify({ cases: [] })))).toBe(0);
  });

  it("--delta-floor gates a low delta; default stays warn-only", () => {
    const low = result({ delta: 0.05 });
    expect(codeOf(check("0", low))).toBe(0);
    expect(codeOf(check("0", low, ["--delta-floor", "0.1"]))).toBe(1);
    const at = result({ delta: 0.1 });
    expect(codeOf(check("0", at, ["--delta-floor", "0.1"]))).toBe(0);
    expect(codeOf(check("0", result(), ["--delta-floor", "0.1"]))).toBe(0);
  });

  it("an invalid run stays inconclusive under --delta-floor", () => {
    const bad = result({ partial: true, delta: -1 });
    expect(codeOf(check("0", bad, ["--delta-floor", "0.1"]))).toBe(7);
  });

  it("rejects a non-numeric --delta-floor", () => {
    expect(codeOf(check("0", result(), ["--delta-floor", "x"]))).toBe(2);
  });

  it("rejects bad arguments with exit 2 and prints help", () => {
    expect(codeOf(main(["r.json"], {}, { readFile: () => ok("") }))).toBe(2);
    expect(main(["--help"], {}, { readFile: () => ok("") }).tag).toBe("ok");
  });
});
