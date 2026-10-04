/**
 * Stage 1 acceptance test (#458): the real lint rules over this repo's real
 * `fetch-execute-guide` cases. The clean run is the exit check; the mutations
 * show the lint would notice the failures the cases were reworked to avoid.
 * Whether a case is *useful* (Δ above zero, stable runs) needs a paid run and
 * is not tested here.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverRules } from "./discover.ts";
import { lintPlugin } from "./runner.ts";
import type { Finding, Rule } from "./types.ts";

const REAL_PLUGIN = join(import.meta.dirname, "..", "..", "..", "..", "fetch-execute-guide");
const ASKS = "fetch-execute-asks-first";
const RUNS = "fetch-execute-runs-with-permission";

const loadRules = async (): Promise<readonly Rule[]> => {
  const found = await discoverRules();
  if (!found.ok) throw new Error(found.message);
  return found.rules;
};

const findingsOf = (root: string, rules: readonly Rule[]): readonly Finding[] => {
  const outcome = lintPlugin(root, rules);
  if (!outcome.ok) throw new Error(outcome.reason);
  // The exit check is "no errors or warnings"; info findings (EVAL020 asks for
  // a negative trigger case this suite does not have) are advice, not failures.
  return outcome.report.findings.filter((f) => f.severity !== "info");
};

const summarize = (findings: readonly Finding[]): readonly string[] =>
  findings.map((f) => `${f.severity} ${f.ruleId} ${f.caseDirName ?? "-"}`);

let copy = "";
beforeEach(() => {
  copy = mkdtempSync(join(tmpdir(), "fetch-execute-guide-"));
  cpSync(REAL_PLUGIN, copy, { recursive: true });
});
afterEach(() => {
  rmSync(copy, { recursive: true, force: true });
});

const caseFile = (name: string): string => join(copy, "evals", name, "case.yaml");

/** Replace `from` with `to` in a copied case file; the replacement must apply. */
const mutate = (name: string, from: string, to: string): void => {
  const text = readFileSync(caseFile(name), "utf8");
  expect(text).toContain(from);
  writeFileSync(caseFile(name), text.replace(from, to));
};

describe("fetch-execute-guide under the real lint rules", () => {
  it("passes with no errors or warnings, with both grants recorded", async () => {
    const rules = await loadRules();
    expect(summarize(findingsOf(REAL_PLUGIN, rules))).toEqual([]);
  });

  it("fails EVAL004 and EVAL005 on both cases when the grants file is removed", async () => {
    const rules = await loadRules();
    rmSync(join(copy, "evals", "grants.yaml"));
    expect(summarize(findingsOf(copy, rules)).toSorted()).toEqual(
      [
        `error EVAL004 ${ASKS}`,
        `error EVAL004 ${RUNS}`,
        `error EVAL005 ${ASKS}`,
        `error EVAL005 ${RUNS}`,
      ],
    );
  });

  it("fails EVAL005 when a case is granted a different tool than its grader needs", async () => {
    const rules = await loadRules();
    writeFileSync(
      join(copy, "evals", "grants.yaml"),
      `schema_version: "1"\ngrants:\n  ${ASKS}:\n    - "Write"\n  ${RUNS}:\n    - "Bash(npx --yes cowsay@latest *)"\n`,
    );
    const found = summarize(findingsOf(copy, rules));
    expect(found).toContain(`error EVAL004 ${ASKS}`);
    expect(found).toContain(`error EVAL005 ${ASKS}`);
    expect(found.filter((f) => f.includes(RUNS))).toEqual([]);
  });

  it("fails EVAL019 when the never-runs check loses its explicit min: 0", async () => {
    const rules = await loadRules();
    mutate(ASKS, "    min: 0\n    max: 0\n", "    max: 0\n");
    expect(summarize(findingsOf(copy, rules))).toEqual([`error EVAL019 ${ASKS}`]);
  });

  it("fails EVAL007 when the Skill indicator is graded but Skill is not allowed", async () => {
    const rules = await loadRules();
    mutate(RUNS, "    - Skill\n", "");
    expect(summarize(findingsOf(copy, rules))).toEqual([`error EVAL007 ${RUNS}`]);
  });
});
