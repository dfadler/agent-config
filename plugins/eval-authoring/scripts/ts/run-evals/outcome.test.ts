import { describe, expect, it } from "vitest";
import { readAggregateResult } from "../parser/index.ts";
import {
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERRUPTED,
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_TERMINATED,
  EXIT_USAGE,
  worstExit,
} from "./exit-codes.ts";
import {
  candidateResultDirs,
  findingsFromText,
  inspectResult,
  interpretCliExit,
  judgeRun,
  type JudgeInput,
  type ResultFindings,
} from "./outcome.ts";
import { scanOutput } from "./output.ts";
import { resultJson } from "./test-support.ts";

const clean: ResultFindings = {
  partial: false,
  partialReason: undefined,
  runErrors: [],
  skippedPaidGraders: [],
};

const judge = (over: Partial<JudgeInput> = {}) =>
  judgeRun({
    status: 0,
    signal: null,
    signals: scanOutput(""),
    findings: clean,
    resultProblem: undefined,
    skipUnavailable: false,
    ...over,
  });

describe("interpretCliExit", () => {
  it("maps the documented codes and signals", () => {
    expect(interpretCliExit(0, null)).toBe("pass");
    expect(interpretCliExit(1, null)).toBe("failed");
    expect(interpretCliExit(2, null)).toBe("partial");
    expect(interpretCliExit(130, null)).toBe("interrupted");
    expect(interpretCliExit(143, null)).toBe("terminated");
    expect(interpretCliExit(null, "SIGINT")).toBe("interrupted");
    expect(interpretCliExit(null, "SIGTERM")).toBe("terminated");
    expect(interpretCliExit(9, null)).toBe("unknown");
  });
});

describe("judgeRun exit mapping", () => {
  it("0 with clean results passes", () => {
    expect(judge()).toEqual({ code: EXIT_OK, reasons: [], stop: false });
  });
  it("CLI 1 is a failure, not partial", () => {
    expect(judge({ status: 1 }).code).toBe(EXIT_FAILURE);
  });
  it("CLI 2 is partial, not the wrapper's usage code", () => {
    const j = judge({ status: 2 });
    expect(j.code).toBe(EXIT_PARTIAL);
    expect(j.code).not.toBe(EXIT_USAGE);
  });
  it("130 and 143 stop the wrapper", () => {
    expect(judge({ status: 130 })).toMatchObject({ code: EXIT_INTERRUPTED, stop: true });
    expect(judge({ status: 143 })).toMatchObject({ code: EXIT_TERMINATED, stop: true });
  });
  it("an unexpected status is a failure", () => {
    expect(judge({ status: 9 }).code).toBe(EXIT_FAILURE);
  });
  it("a pass with unreadable results cannot be trusted", () => {
    const j = judge({ findings: undefined, resultProblem: "no file" });
    expect(j.code).toBe(EXIT_FAILURE);
    expect(j.reasons.join()).toContain("no file");
  });
  it("a failure with unreadable results adds nothing extra", () => {
    expect(judge({ status: 1, findings: undefined }).reasons).toHaveLength(1);
  });
});

describe("judgeRun result checks", () => {
  it("a partial result is partial even when the CLI exited 0", () => {
    const j = judge({ findings: { ...clean, partial: true, partialReason: "cost_ceiling" } });
    expect(j.code).toBe(EXIT_PARTIAL);
    expect(j.reasons.join()).toContain("cost_ceiling");
  });
  it("a run error is not a regression and is never a pass", () => {
    const j = judge({
      findings: {
        ...clean,
        runErrors: [{ caseName: "c", arm: "with", run: 2, error: "rate limit" }],
      },
    });
    expect(j.code).toBe(EXIT_PARTIAL);
    expect(j.reasons.join("\n")).toContain("c (with arm, run 2): rate limit");
  });
  it("skipped paid graders make the score not comparable", () => {
    const j = judge({ findings: { ...clean, skippedPaidGraders: ["c"] } });
    expect(j.code).toBe(EXIT_PARTIAL);
    expect(j.reasons.join()).toContain("not comparable");
  });
  it("combines failure and partial into the more severe code", () => {
    expect(
      judge({ status: 1, findings: { ...clean, partial: true, partialReason: undefined } }).code,
    ).toBe(EXIT_PARTIAL);
  });
});

describe("judgeRun output signals", () => {
  it("surfaces the CLI preflight warning as a config error, even on exit 0", () => {
    const j = judge({
      signals: scanOutput("warning: case x cannot pass with the granted tools\n"),
    });
    expect(j.code).toBe(EXIT_CONFIG);
    expect(j.reasons.join("\n")).toContain("cannot pass with the granted tools");
  });
  it("treats early access as an unmet requirement and stops", () => {
    const j = judge({
      status: 1,
      signals: scanOutput("plugin eval is currently in early access"),
    });
    expect(j).toMatchObject({ code: EXIT_DEPENDENCY, stop: true });
    expect(j.reasons.join()).toContain("--skip-unavailable");
  });
  it("skips (exit 0) when asked, without also reporting a threshold failure", () => {
    const j = judge({
      status: 1,
      signals: scanOutput("Plugin eval is currently unavailable"),
      skipUnavailable: true,
    });
    expect(j).toMatchObject({ code: EXIT_OK, stop: true });
  });
  it("ignores unavailable text on a passing run", () => {
    expect(judge({ signals: scanOutput("currently unavailable") }).code).toBe(EXIT_OK);
  });
});

describe("scanOutput", () => {
  it("finds nothing in ordinary output", () => {
    expect(scanOutput("all good")).toEqual({
      earlyAccess: false,
      unavailable: false,
      cannotPass: [],
    });
  });
});

describe("inspectResult", () => {
  const read = (text: string) => {
    const r = readAggregateResult(text);
    if (!r.ok) throw new Error(r.reason);
    return inspectResult(r.result);
  };
  it("finds errors in both arms and skipped paid graders", () => {
    const f = read(
      resultJson({
        partial: true,
        partialReason: "auth_failed",
        cases: [
          {
            name: "x",
            aggregates: {},
            arms: {
              with: [{ score: 1, error: null }, { score: 0, error: "usage limit" }],
              without: [{ score: 0, error: "boom", skippedPaidGraders: true }],
            },
          },
        ],
      }),
    );
    expect(f.partial).toBe(true);
    expect(f.partialReason).toBe("auth_failed");
    expect(f.runErrors).toEqual([
      { caseName: "x", arm: "with", run: 2, error: "usage limit" },
      { caseName: "x", arm: "without", run: 1, error: "boom" },
    ]);
    expect(f.skippedPaidGraders).toEqual(["x"]);
  });
  it("is clean for a clean result", () => {
    expect(read(resultJson())).toEqual(clean);
  });
});

describe("findingsFromText and candidateResultDirs", () => {
  it("explains a missing or unsupported file", () => {
    expect(findingsFromText(undefined, "d").problem).toContain("no aggregate-result.json");
    expect(findingsFromText("{}", "d").problem).toContain("schemaVersion");
    expect(findingsFromText(resultJson(), "d").findings).toEqual(clean);
  });
  it("lists the base then its children in order", () => {
    expect(candidateResultDirs("/r", ["b", "a"])).toEqual(["/r", "/r/a", "/r/b"]);
  });
});

describe("worstExit", () => {
  it("picks the more severe code", () => {
    expect(worstExit(EXIT_FAILURE, EXIT_PARTIAL)).toBe(EXIT_PARTIAL);
    expect(worstExit(EXIT_PARTIAL, EXIT_FAILURE)).toBe(EXIT_PARTIAL);
    expect(worstExit(EXIT_TERMINATED, EXIT_DEPENDENCY)).toBe(EXIT_TERMINATED);
  });
});
