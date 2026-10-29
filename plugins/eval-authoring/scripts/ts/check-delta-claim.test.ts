import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { headerReplies, regexPasses } from "./check-replies.ts";
import { readSuite, type RegexGrader } from "./parser/index.ts";

// Replays the replies in delta-claim-after-run's header against its no_numeric_delta grader (#826).
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const c = readSuite(root).cases.find((x) => x.dirName === "delta-claim-after-run");
const yaml = readFileSync(c?.caseYamlFile ?? "", "utf8");
const grader = c?.graders.find((g): g is RegexGrader => g.type === "regex" && g.name.value === "no_numeric_delta");
function need(): RegexGrader {
  if (!grader) throw new Error("no_numeric_delta grader not found");
  return grader;
}
const alsoBad = [...yaml.matchAll(/^#   - (.+)$/gm)].map((m) => m[1] ?? "");

describe("no_numeric_delta", () => {
  it("finds the grader and the four also-bad replies", () => {
    expect(grader).toBeDefined();
    expect(alsoBad).toHaveLength(4);
  });
  it.each([headerReplies(yaml).bad ?? "", ...alsoBad])("fails: %s", (reply) => {
    expect(regexPasses(need(), reply)).toBe(false);
  });
  it("passes the good reply", () => {
    expect(regexPasses(need(), headerReplies(yaml).good ?? "")).toBe(true);
  });
  it.each([
    "Delta not measured; I won't state one.",
    "I can't give you a +0.33 here and won't say improves by 33 points.",
  ])("passes a refusal: %s", (reply) => {
    expect(regexPasses(need(), reply)).toBe(true);
  });
});
