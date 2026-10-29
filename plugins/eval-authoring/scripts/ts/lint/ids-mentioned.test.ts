/**
 * #449: every rule ID named in the plugin's prose (skills, agents, references,
 * README, docs) and in the repo's root README.md and docs/ must be a rule
 * `--list-rules` prints. docs-table.test.ts covers the rule table itself; this
 * covers the mentions everywhere else.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { expect, it } from "vitest";
import { mainWithDiscoveredRules } from "./cli.ts";

const PLUGIN = "plugins/eval-authoring";
const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");

/** Plugin-relative directories whose .md files are fixtures or results, not prose. */
const SKIP_DIRS = ["evals", "tests", "node_modules"];

/**
 * IDs a file may name although no such rule exists, keyed by repo-relative
 * path. Add a retired or illustrative ID here (one line, with the reason)
 * rather than scrubbing the prose. An entry the file no longer mentions fails.
 */
const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  // The "Worked example" in the how-to-add-a-rule section is deliberately fake.
  [`${PLUGIN}/docs/lint-rules.md`]: ["EVAL900"],
};

const ids = (text: string, re: RegExp): string[] =>
  [...text.matchAll(re)].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** Repo-relative .md paths under `dir` (a repo-relative directory), skipping fixture dirs. */
const mdUnder = (dir: string, skip: readonly string[]): string[] =>
  readdirSync(join(REPO_ROOT, dir), { recursive: true, encoding: "utf8" })
    .map((p) => p.split(sep).join("/"))
    .filter((p) => p.endsWith(".md"))
    .filter((p) => !skip.some((d) => p === d || p.startsWith(`${d}/`)))
    .map((p) => `${dir}/${p}`);

const proseFiles = (): string[] =>
  [...mdUnder(PLUGIN, SKIP_DIRS), ...mdUnder("docs", []), "README.md"].sort();

const mentions = (file: string): string[] => [
  ...new Set(ids(readFileSync(join(REPO_ROOT, file), "utf8"), /\b(EVAL\d+)\b/g)),
];

it("every EVALnnn mentioned in plugin and repo prose is a rule --list-rules prints", async () => {
  const known = new Set(
    ids((await mainWithDiscoveredRules(["--list-rules"])).stdout, /^(EVAL\d{3})\s/gm),
  );
  expect(known.size).toBeGreaterThan(0);
  const files = proseFiles();
  expect(files).toContain("README.md");
  expect(files).toContain(`${PLUGIN}/README.md`);
  expect(files.some((f) => f.startsWith("docs/"))).toBe(true);
  const unknown = files.flatMap((file) => {
    const allowed = ALLOWED[file] ?? [];
    return mentions(file)
      .filter((id) => !known.has(id) && !allowed.includes(id))
      .map((id) => `${file}: ${id}`);
  });
  expect(unknown).toEqual([]);
});

it("every allowlisted ID is still mentioned in its file", () => {
  const stale = Object.entries(ALLOWED).flatMap(([file, allowed]) => {
    const present = mentions(file);
    return allowed.filter((id) => !present.includes(id)).map((id) => `${file}: ${id}`);
  });
  expect(stale).toEqual([]);
});
