/**
 * Pins the documented output shapes of grader-red-team and blind-case-writer (#773) against
 * kept real final reports in fixtures/agent-reports/. Free and offline; the checks are
 * tolerant of bullets, numbering and wording drift, and strict about the sentinels.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (f: string): string =>
  readFileSync(new URL(`./fixtures/agent-reports/${f}`, import.meta.url), "utf8");

// grader-red-team: exactly one of `Clean`, `Clean (free graders); llm: needs a run`,
// `llm: needs a run`, or at least one `<case>:<grader> | probe/by hand | wrong reply: ... | Fix: ...` line.
const FINDING = /^.*\| (?:probe|by hand)[^|]*\| wrong reply: .+\| .*Fix: /m;
const verdict = (t: string): boolean =>
  /^Clean( \(free graders\); llm: needs a run)?\s*$/m.test(t) ||
  /llm: needs a run/.test(t) ||
  FINDING.test(t);
// A bare `Clean` never sits next to a defect (`Case accepts:`).
const noFalseClean = (t: string): boolean => !(/^Clean\s*$/m.test(t) && /^Case accepts:/m.test(t));

// blind-case-writer mode 1: a fenced yaml case, the Undecided section, the closing provenance line.
const draftReport = (t: string): boolean =>
  /schema_version: "1\.1"/.test(t) &&
  /^## Undecided by the text/m.test(t) &&
  /Drafts are from the target text only;/.test(t);
// mode 2: prompts only, as a list of at least 10 items, with no fenced block.
const promptsReport = (t: string): boolean =>
  !/^`{3}/m.test(t) && (t.match(/^\s*(?:\d+[.)]|[-*])\s+/gm) ?? []).length >= 10;

const golden: [string, string, (t: string) => boolean][] = [
  ["grt-clean.txt", "verdict", verdict],
  ["grt-clean.txt", "no false Clean", noFalseClean],
  ["grt-findings-strict.txt", "verdict", verdict],
  ["grt-findings-strict.txt", "no false Clean", noFalseClean],
  ["grt-findings-drifted.txt", "verdict", verdict],
  ["grt-findings-drifted.txt", "no false Clean", noFalseClean],
  ["grt-llm-needs-run.txt", "verdict", verdict],
  ["bcw-mode1.txt", "draft report", draftReport],
  ["bcw-mode1-nopaths.txt", "draft report", draftReport],
  ["bcw-mode2.txt", "prompts report", promptsReport],
];

describe("kept real reports", () => {
  it.each(golden)("%s passes the %s shape", (file, _name, check) => {
    expect(check(read(file))).toBe(true);
  });

  it("the strict findings report really carries a Case accepts line (so no false Clean is not vacuous)", () => {
    expect(read("grt-findings-strict.txt")).toMatch(/^Case accepts:/m);
  });
});

describe("negative controls", () => {
  const prose = "I looked at the case and it seems fine overall.";
  it("rejects a prose-only reply", () => {
    expect(verdict(prose)).toBe(false);
    expect(draftReport(prose)).toBe(false);
    expect(promptsReport(prose)).toBe(false);
  });

  it("rejects a Clean next to a defect", () => {
    expect(noFalseClean("Clean\n\nCase accepts: the echoed prompt")).toBe(false);
  });

  it("rejects a draft report missing a sentinel", () => {
    const good = read("bcw-mode1.txt");
    expect(draftReport(good.replace(/^## Undecided by the text/m, "## Notes"))).toBe(false);
    expect(draftReport(good.replace(/Drafts are from the target text only;/, "Done;"))).toBe(false);
    expect(draftReport(good.replace(/schema_version: "1\.1"/g, "schema_version: 2"))).toBe(false);
  });

  it("rejects a findings report whose line lost its Fix", () => {
    expect(verdict(read("grt-findings-strict.txt").replace(/Fix: /g, "Try: "))).toBe(false);
  });
});
