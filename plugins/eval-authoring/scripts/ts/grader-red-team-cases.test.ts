/**
 * The grader-red-team smoke cases' reply regexes accept the agent's right verdicts (as the main
 * model might relay them) and reject the opposite ones (#859). check-replies.ts covers only one
 * good and one bad reply per case; these are the other wordings.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readSuite } from "./parser/index.ts";
import { regexPasses } from "./check-replies.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cases = readSuite(root).cases;

/** Does every `last_message` regex grader of the case accept this reply? */
const accepts = (name: string, reply: string): boolean => {
  const c = cases.find((x) => x.dirName === name);
  if (c === undefined) throw new Error(`no case ${name}`);
  return c.graders.every(
    (g) => g.type !== "regex" || g.target.value.kind !== "last_message" || regexPasses(g, reply),
  );
};

describe("grader-red-team-flags-planted-weak-grader", () => {
  const name = "grader-red-team-flags-planted-weak-grader";
  it.each([
    'names_breaking_change | by hand | wrong reply: "No breaking changes this release." | passes because the pattern is the bare word | Fix: anchor it',
    'The grader `names_breaking_change` can be fooled: a reply like "There are no breaking changes in this release" would pass it.',
    "`names_breaking_change` | probe | wrong reply: `Breaking: none` | passes | Fix: anchor",
  ])("accepts an affirmative finding: %s", (reply) => {
    expect(accepts(name, reply)).toBe(true);
  });
  it.each([
    "names_breaking_change passes no wrong replies; every weak reply it tried is rejected.",
    "No wrong reply passes names_breaking_change.",
    "None of the wrong replies pass `names_breaking_change`.",
    "names_breaking_change accepts none of the wrong replies I tried.",
    "Clean. names_breaking_change rejects every weak reply it tried.",
    "Clean",
    "names_breaking_change is weak and could be fooled by a wrong reply.",
  ])("rejects a denial, a bare verdict or a finding with no quoted wrong reply: %s", (reply) => {
    expect(accepts(name, reply)).toBe(false);
  });
});

describe("grader-red-team-clean-case-control", () => {
  const name = "grader-red-team-clean-case-control";
  it.each([
    "Clean",
    "Clean. The agent found no wrong reply that would still pass status_object.",
    "Clean. status_object rejected every wrong reply; none passes it.",
    "The agent found no weakness: the pattern is anchored to the whole reply.",
  ])("accepts a clean verdict: %s", (reply) => {
    expect(accepts(name, reply)).toBe(true);
  });
  it.each([
    "Looks good, but `status_object` accepts a wrong reply.",
    "Clean overall, but `status_object` accepts a wrong reply that adds extra prose.",
    "Clean, though a wrong reply would pass status_object.",
    "Clean, but status_object also passes a fenced version of the object.",
    'Clean apart from this: status_object | by hand | wrong reply: "x" | passes because loose',
    "Clean.\nCase accepts: the object with a trailing note",
  ])("rejects a defect relayed with a clean verdict: %s", (reply) => {
    expect(accepts(name, reply)).toBe(false);
  });
  it("does not take a hedge such as 'looks good' for a clean verdict", () => {
    expect(accepts(name, "Looks good to me.")).toBe(false);
  });
});
