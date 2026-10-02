import { describe, expect, it } from "vitest";
import { readAggregateResult } from "./result.ts";

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
        graders: [{ name: "g", type: "regex" }],
        arms: {
          with: [
            {
              score: 1,
              passed: true,
              error: null,
              skippedPaidGraders: false,
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
        aggregates: { score: 1, delta: 0.5 },
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
    expect(c1?.aggregates).toEqual({ delta: 0.5 });
    expect(c1?.withRuns).toEqual([
      {
        score: 1,
        error: null,
        skippedPaidGraders: false,
        graders: [{ name: "g", passed: true, scored: true }],
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

  it("tolerates odd shapes inside cases", () => {
    const out = readAggregateResult(
      JSON.stringify({
        schemaVersion: 1,
        cases: [7, { arms: { with: [null, { graders: "x", error: 5 }] } }],
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
  ])("reports %s", (_n, text, reason) => {
    const out = readAggregateResult(text);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toContain(reason);
  });
});
