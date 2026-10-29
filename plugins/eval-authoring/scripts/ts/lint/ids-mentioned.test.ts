/**
 * #449: every rule ID named in the plugin's prose (skills, agents, references,
 * README, docs) must be a rule `--list-rules` prints. docs-table.test.ts covers
 * the rule table itself; this covers the mentions everywhere else.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, it } from "vitest";
import { mainWithDiscoveredRules } from "./cli.ts";

const PLUGIN_ROOT = join(import.meta.dirname, "..", "..", "..");

/** Plugin-relative directories whose .md files are fixtures or results, not prose. */
const SKIP_DIRS = ["evals", "tests", "node_modules"];

/**
 * IDs a file may name although no such rule exists, keyed by plugin-relative
 * path. Add a retired or illustrative ID here (one line, with the reason)
 * rather than scrubbing the prose.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // The "Worked example" in the how-to-add-a-rule section is deliberately fake.
  "docs/lint-rules.md": ["EVAL900"],
};

const ids = (text: string, re: RegExp): string[] =>
  [...text.matchAll(re)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

const proseFiles = (): string[] =>
  readdirSync(PLUGIN_ROOT, { recursive: true, encoding: "utf8" })
    .filter((p) => p.endsWith(".md"))
    .map((p) => p.split(sep).join("/"))
    .filter((p) => !SKIP_DIRS.some((d) => p === d || p.startsWith(`${d}/`)))
    .sort();

it("every EVALnnn mentioned in plugin prose is a rule --list-rules prints", async () => {
  const known = new Set(
    ids((await mainWithDiscoveredRules(["--list-rules"])).stdout, /^(EVAL\d{3})\s/gm),
  );
  expect(known.size).toBeGreaterThan(0);
  const files = proseFiles();
  expect(files).toContain("README.md");
  const unknown = files.flatMap((file) => {
    const allowed = ALLOWED[file] ?? [];
    const text = readFileSync(join(PLUGIN_ROOT, file), "utf8");
    return [...new Set(ids(text, /\b(EVAL\d{3})\b/g))]
      .filter((id) => !known.has(id) && !allowed.includes(id))
      .map((id) => `${file}: ${id}`);
  });
  expect(unknown).toEqual([]);
});
