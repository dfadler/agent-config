/**
 * The fixture harness (#453). Every rule in `rules/` needs fixtures under
 * `tests/lint-fixtures/<RULE_ID>/`: one or more `good-*` directories on which
 * the rule stays quiet and one or more `bad-*` directories on which it fires.
 * Each fixture directory is a miniature plugin root (`evals/<case>/...`, and
 * optionally `evals/grants.yaml` or `.claude-plugin/plugin.json`). An optional
 * `fixture.json` of the form `{ "fires": ["case-dir", ...] }` pins exactly
 * which cases a `bad-*` fixture must fire on. This file is generic: rule
 * authors add a rule file and fixtures, and never edit it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverRules } from "./discover.ts";
import { lintPlugin, PARSE_RULE_ID } from "./runner.ts";

const FIXTURES = join(import.meta.dirname, "..", "..", "..", "tests", "lint-fixtures");

const found = await discoverRules();
const rules = found.ok ? found.rules : [];

const dirs = (p: string): readonly string[] =>
  existsSync(p)
    ? readdirSync(p)
        .filter((n) => !n.startsWith("."))
        .filter((n) => statSync(join(p, n)).isDirectory())
        .sort()
    : [];

/** `fires` from a fixture's `fixture.json`, or undefined when absent or not a string list. */
const readFires = (fixtureDir: string): readonly string[] | undefined => {
  const file = join(fixtureDir, "fixture.json");
  if (!existsSync(file)) return undefined;
  const doc: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof doc !== "object" || doc === null || !("fires" in doc)) {
    throw new Error(`${file}: expected { "fires": [...] }`);
  }
  const fires = doc.fires;
  if (!Array.isArray(fires) || !fires.every((x) => typeof x === "string")) {
    throw new Error(`${file}: "fires" must be a list of case directory names`);
  }
  return fires.flatMap((x) => (typeof x === "string" ? [x] : [])).sort();
};

describe("lint rules load", () => {
  it("discovers and validates every rule file", () => {
    expect(found).toMatchObject({ ok: true });
    expect(rules.length).toBeGreaterThan(0);
  });
});

describe("fixture coverage", () => {
  it("has no fixture directory that is not a rule ID, and only good-*/bad-* inside", () => {
    const ids = new Set(rules.map((r) => r.id));
    const stray = dirs(FIXTURES).filter((d) => !ids.has(d));
    expect(stray).toEqual([]);
    const misnamed = dirs(FIXTURES).flatMap((d) =>
      dirs(join(FIXTURES, d))
        .filter((f) => !/^(good|bad)-/.test(f))
        .map((f) => `${d}/${f}`),
    );
    expect(misnamed).toEqual([]);
  });

  describe.each(rules.map((r) => r.id))("%s", (id) => {
    const fixtures = dirs(join(FIXTURES, id));
    it("has at least one good and one bad fixture", () => {
      expect(fixtures.some((f) => f.startsWith("good-"))).toBe(true);
      expect(fixtures.some((f) => f.startsWith("bad-"))).toBe(true);
    });

    describe.each(fixtures)("%s", (fixture) => {
      const root = join(FIXTURES, id, fixture);
      const isBad = fixture.startsWith("bad-");
      it(isBad ? `fires ${id}` : `leaves ${id} quiet`, () => {
        const outcome = lintPlugin(root, rules);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const { findings } = outcome.report;
        // A fixture that does not parse proves nothing about the rule.
        expect(findings.filter((f) => f.ruleId === PARSE_RULE_ID)).toEqual([]);
        const mine = findings.filter((f) => f.ruleId === id);
        if (!isBad) {
          expect(mine).toEqual([]);
          return;
        }
        expect(mine.length).toBeGreaterThan(0);
        const fires = readFires(root);
        if (fires !== undefined) {
          expect([...new Set(mine.map((f) => f.caseDirName))].sort()).toEqual(
            fires,
          );
        }
      });
    });
  });
});
