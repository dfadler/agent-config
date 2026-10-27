/** #765: the rule table in docs/lint-rules.md must list exactly the rules `--list-rules` prints. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { mainWithDiscoveredRules } from "./cli.ts";

const ids = (text: string, re: RegExp): string[] =>
  [...text.matchAll(re)].flatMap((m) => (m[1] === undefined ? [] : [m[1]])).sort();

it("docs/lint-rules.md table matches --list-rules", async () => {
  const doc = readFileSync(
    join(import.meta.dirname, "..", "..", "..", "docs", "lint-rules.md"),
    "utf8",
  );
  const documented = ids(doc, /^\| (EVAL\d+) \|/gm);
  const listed = ids((await mainWithDiscoveredRules(["--list-rules"])).stdout, /^(EVAL\d+)\s/gm);
  expect(listed.length).toBeGreaterThan(0);
  expect(documented).toEqual(listed);
});

it("keeps duplicate IDs so a repeated row fails the comparison", () => {
  const re = /^\| (EVAL\d+) \|/gm;
  expect(ids("| EVAL001 | a |\n| EVAL001 | b |\n", re)).not.toEqual(ids("| EVAL001 | a |\n", re));
});
