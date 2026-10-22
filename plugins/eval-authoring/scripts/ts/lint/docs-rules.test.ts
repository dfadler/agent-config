/** docs/lint-rules.md lists exactly the rule IDs --list-rules prints (#765). */
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { mainWithDiscoveredRules } from "./cli.ts";

const ids = (text: string, re: RegExp): string[] => [...text.matchAll(re)].map((m) => m[1] ?? "").sort();

it("lint-rules.md rule table matches --list-rules", async () => {
  const docs = readFileSync(new URL("../../../docs/lint-rules.md", import.meta.url), "utf8");
  const listed = await mainWithDiscoveredRules(["--list-rules"]);
  const inDocs = ids(docs, /^\| (EVAL\d{3}) \|/gm);
  expect(inDocs.length).toBeGreaterThan(0);
  expect(inDocs).toEqual(ids(listed.stdout, /^(EVAL\d{3}) /gm));
});
