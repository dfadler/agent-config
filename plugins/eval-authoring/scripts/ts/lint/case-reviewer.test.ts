/** The case-reviewer agent must carry the #713 judgment checks (sources, sabotage note, near-misses, behavior over phrase). */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const body = readFileSync(
  new URL("../../../agents/case-reviewer.md", import.meta.url),
  "utf8",
);

it("case-reviewer.md runs the lint with the opt-in EVAL009 enabled", () => {
  expect(body).toMatch(/lint\/cli\.ts --enable EVAL009 --format json/);
});

it.each([
  ["source link", /platform claim with no source link/],
  ["sabotage note", /which\s+sentence of the skill, if deleted/],
  ["near-miss per area", /near-miss case\s+\(shared vocabulary/],
  ["verbatim phrase", /verbatim\s+phrase the skill happens to contain/],
])("case-reviewer.md names the %s check", (_name, re) => {
  expect(body).toMatch(re);
});
