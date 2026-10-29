import { describe, expect, it } from "vitest";
import { isErrored, readAggregateResult } from "./result.ts";

const doc = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    claudeVersion: "2.1.287",
    partial: false,
    suite: { root: "x" },
    cases: [
      {
        name: "c1",
        dir: "d",
        maxTurns: 4,
        graders: [{ name: "g", type: "regex" }],
        arms: {
          with: [
            {
              score: 1,
              passed: true,
              error: null,
              skippedPaidGraders: false,
              turns: 3,
              tracePath: "t",
              graders: [
                {
                  name: "g",
                  passed: true,
                  weight: 1,
                  explanation: "e",
                  withOnly: false,
                  scored: true,
                  futureField: 1,
                },
              ],
            },
          ],
          without: [{ score: 0, error: "rate limited", aborted: true }],
        },
        aggregates: {
          score: 1,
          passRate: 1,
          scoreWithout: 0.5,
          passRateWithout: 0,
          delta: 0.5,
        },
      },
      {
        name: "c2",
        arms: { with: [{ score: 0.5, error: { message: "boom" } }] },
        aggregates: {},
      },
    ],
    aggregates: { casesTotal: 2 },
    ...extra,
  });

describe("readAggregateResult", () => {
  it("reads runs, graders and delta, ignoring unknown fields", () => {
    const out = readAggregateResult(doc());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const [c1, c2] = out.result.cases;
    expect(out.result).toMatchObject({ schemaVersion: 1, partial: false });
    expect(out.result.partialReason).toBeUndefined();
    expect(c1?.aggregates).toEqual({
      delta: 0.5,
      score: 1,
      passRate: 1,
      scoreWithout: 0.5,
      passRateWithout: 0,
    });
    expect(c1?.maxTurns).toBe(4);
    expect(c2?.maxTurns).toBeUndefined();
    expect(c1?.withRuns).toEqual([
      {
        score: 1,
        error: null,
        skippedPaidGraders: false,
        turns: 3,
        graders: [
          {
            name: "g",
            passed: true,
            scored: true,
            weight: 1,
            explanation: "e",
            withOnly: false,
          },
        ],
      },
    ]);
    expect(c1?.withoutRuns).toEqual([
      { score: 0, error: "rate limited", aborted: true },
    ]);
    // Omitted delta and omitted `without` arm.
    expect(c2?.aggregates).toEqual({});
    expect(c2?.withoutRuns).toEqual([]);
    expect(c2?.withRuns[0]?.error).toBe("boom");
  });

  it("reads partial and partialReason", () => {
    const out = readAggregateResult(
      doc({ partial: true, partialReason: "cost ceiling" }),
    );
    expect(out.ok && out.result).toMatchObject({
      partial: true,
      partialReason: "cost ceiling",
    });
  });

  it("tolerates odd shapes inside runs", () => {
    const out = readAggregateResult(
      JSON.stringify({
        schemaVersion: 1,
        cases: [{ arms: { with: [{ graders: "x", error: 5 }] } }],
      }),
    );
    expect(out.ok && out.result.cases).toEqual([
      { name: "", aggregates: {}, withRuns: [{}], withoutRuns: [] },
    ]);
  });

  it.each([
    ["not JSON", "nope", "not a JSON object"],
    ["an array", "[]", "not a JSON object"],
    ["no schemaVersion", '{"cases":[]}', "(missing)"],
    ["wrong schemaVersion", '{"schemaVersion":2,"cases":[]}', "2"],
    ["no cases", '{"schemaVersion":1}', "missing cases"],
    ["empty cases", '{"schemaVersion":1,"cases":[]}', "no cases"],
    [
      "a case with no with-runs",
      '{"schemaVersion":1,"cases":[{"name":"x","arms":{"without":[{"score":1}]}}]}',
      "x: no with-arm runs",
    ],
    [
      "a dropped case",
      '{"schemaVersion":1,"cases":[7,{"arms":{"with":[{}]}}]}',
      "1 malformed",
    ],
    [
      "a dropped run",
      '{"schemaVersion":1,"cases":[{"arms":{"with":[null,{}]}}]}',
      "1 malformed",
    ],
  ])("reports %s", (_n, text, reason) => {
    const out = readAggregateResult(text);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toContain(reason);
  });
});

describe("isErrored", () => {
  it("counts any string error, including the empty string (#735)", () => {
    expect(isErrored({ error: "boom" })).toBe(true);
    expect(isErrored({ error: "" })).toBe(true);
  });
  it("does not count null, undefined or non-strings", () => {
    expect(isErrored({ error: null })).toBe(false);
    expect(isErrored({})).toBe(false);
    expect(isErrored({ error: 1 })).toBe(false);
  });
});
