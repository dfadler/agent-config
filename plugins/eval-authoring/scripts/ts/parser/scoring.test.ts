import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readCase } from "./case.ts";
import { graderCategory, isScored, scoreCase } from "./scoring.ts";
import type { EvalCase, Grader } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "eval-authoring-scoring-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A case from inline graders (case.yaml lines). */
const caseWith = (name: string, graders: string): EvalCase => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "case.yaml"),
    `schema_version: "1.1"\nname: ${name}\ngraders:\n${graders}`,
  );
  return readCase(dir);
};

const one = (name: string, graders: string): Grader => {
  const g = caseWith(name, graders).graders[0];
  if (g === undefined) throw new Error("no grader");
  return g;
};

const declared = { declaredMockServers: new Set(["srv"]) };
const none = { declaredMockServers: new Set<string>() };

describe("isScored", () => {
  const skill = "  - type: tool_used\n    tool: Skill\n";
  const withOnly = "  - type: regex\n    pattern: x\n    arm: with-only\n";
  const both = "  - type: tool_used\n    tool: Skill\n    arm: both\n";
  const bothWithOnlySkill = "  - type: regex\n    pattern: x\n    arm: both\n";
  const mock = "  - type: regex\n    pattern: x\n    target: mock_calls\n";
  const mockBoth = `${mock}    arm: both\n`;
  const llmMock = "  - type: llm\n    criteria: c\n    focus: mock_calls\n";
  const plain = "  - type: regex\n    pattern: x\n";

  it("scores everything in a one-arm run", () => {
    [skill, withOnly, mock, plain].forEach((g, i) => {
      expect(isScored(one(`one-${String(i)}`, g), false, declared)).toBe(true);
    });
  });

  it("excludes a Skill grader implicitly in a two-arm run", () => {
    expect(isScored(one("skill", skill), true)).toBe(false);
  });

  it("excludes arm: with-only", () => {
    expect(isScored(one("wo", withOnly), true)).toBe(false);
  });

  it("scores arm: both even for a Skill grader", () => {
    expect(isScored(one("both", both), true)).toBe(true);
    expect(isScored(one("both2", bothWithOnlySkill), true)).toBe(true);
  });

  it("excludes mock_calls graders on a declared mock, unless arm: both", () => {
    expect(isScored(one("m1", mock), true, declared)).toBe(false);
    expect(isScored(one("m2", llmMock), true, declared)).toBe(false);
    expect(isScored(one("m3", mockBoth), true, declared)).toBe(true);
    expect(isScored(one("m4", mock), true, none)).toBe(true);
    expect(isScored(one("m5", mock), true)).toBe(true);
  });

  it("scores ordinary graders", () => {
    expect(isScored(one("p", plain), true)).toBe(true);
  });
});

describe("scoreCase", () => {
  it("gives reasons for exclusions", () => {
    const c = caseWith(
      "reasons",
      [
        "  - type: tool_used\n    tool: Skill\n",
        "  - type: regex\n    pattern: x\n    arm: with-only\n",
        "  - type: regex\n    pattern: x\n    target: mock_calls\n",
        "  - type: regex\n    pattern: y\n",
      ].join(""),
    );
    const s = scoreCase(c, true, declared);
    expect(s.allExcludedFallback).toBe(false);
    expect(s.graders.map((g) => [g.scored, g.reason])).toEqual([
      [false, "skill-grader-implicit-with-only"],
      [false, "arm-with-only"],
      [false, "mock-calls-on-declared-mock"],
      [true, undefined],
    ]);
  });

  it("falls back to scoring all when every grader would be excluded", () => {
    const c = caseWith(
      "fallback",
      "  - type: tool_used\n    tool: Skill\n  - type: regex\n    pattern: x\n    arm: with-only\n",
    );
    const s = scoreCase(c, true);
    expect(s.allExcludedFallback).toBe(true);
    expect(s.graders.every((g) => g.scored && g.reason === undefined)).toBe(
      true,
    );
  });

  it("scores everything with one arm, and has no fallback for no graders", () => {
    const c = caseWith(
      "onearm",
      "  - type: tool_used\n    tool: Skill\n",
    );
    expect(scoreCase(c, false).graders[0]?.scored).toBe(true);
    expect(scoreCase(c, false).allExcludedFallback).toBe(false);
    const empty = readCase(join(root, "onearm"));
    expect(scoreCase({ ...empty, graders: [] }, true).allExcludedFallback).toBe(
      false,
    );
  });
});

describe("graderCategory", () => {
  it.each([
    ["tool_used", "  - type: tool_used\n    tool: Bash\n", "steps"],
    [
      "tool_order",
      "  - type: tool_order\n    before: A\n    after: B\n",
      "steps",
    ],
    ["regex last_message", "  - type: regex\n    pattern: x\n", "result"],
    [
      "regex trace",
      "  - type: regex\n    pattern: x\n    target: trace\n",
      "steps",
    ],
    [
      "regex mock_calls",
      "  - type: regex\n    pattern: x\n    target: mock_calls\n",
      "steps",
    ],
    [
      "regex files",
      "  - type: regex\n    pattern: x\n    target: files\n",
      "result",
    ],
    [
      "regex file",
      "  - type: regex\n    pattern: x\n    target: { source: file, path: a }\n",
      "result",
    ],
    ["llm default", "  - type: llm\n    criteria: c\n", "result"],
    [
      "llm trace",
      "  - type: llm\n    criteria: c\n    focus: trace\n",
      "steps",
    ],
    ["file_exists", "  - type: file_exists\n    path: a\n", "result"],
    [
      "baseline",
      "  - type: baseline\n    baseline_file: b.jsonl\n",
      "result",
    ],
    ["unknown type", "  - type: nope\n", undefined],
  ])("%s", (name, graders, expected) => {
    expect(graderCategory(one(`cat-${name}`, graders))).toBe(expected);
  });
});
