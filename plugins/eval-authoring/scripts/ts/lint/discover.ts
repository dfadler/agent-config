/**
 * Rule auto-discovery (#453). Every `rules/evalNNN-<slug>.ts` that is not a
 * test exports a `rule`; the runner imports them all, so a new rule is one new
 * file and no shared registry changes. The checks here turn a typo in a rule
 * file into a clear startup error instead of a rule that silently never runs.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Rule, Severity } from "./types.ts";

/** Where the rules live: `lint/rules/`, next to this file. */
export const RULES_DIR = join(import.meta.dirname, "rules");

/** A rule file name: `eval004-grants.ts`. Other `.ts` files in `rules/` (except tests) are rejected. */
const RULE_FILE = /^(eval\d{3})-[a-z0-9]+(?:-[a-z0-9]+)*\.ts$/;
const RULE_ID = /^EVAL\d{3}$/;

const SEVERITIES: readonly string[] = ["error", "warn", "info"] satisfies readonly Severity[];

const isRecord = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === "object" && v !== null;

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim() !== "";

/** Whether `v` has the shape of a `Rule`. */
export const isRule = (v: unknown): v is Rule =>
  isRecord(v) &&
  typeof v["id"] === "string" &&
  RULE_ID.test(v["id"]) &&
  typeof v["severity"] === "string" &&
  SEVERITIES.includes(v["severity"]) &&
  isNonEmptyString(v["title"]) &&
  isNonEmptyString(v["source"]) &&
  (v["checkCase"] === undefined || typeof v["checkCase"] === "function") &&
  (v["checkSuite"] === undefined || typeof v["checkSuite"] === "function") &&
  (typeof v["checkCase"] === "function" || typeof v["checkSuite"] === "function");

/** One imported rule file: its name and whatever it exported as `rule`. */
export interface RuleModule {
  readonly fileName: string;
  readonly exported: unknown;
}

export type Discovery =
  | { readonly ok: true; readonly rules: readonly Rule[] }
  | { readonly ok: false; readonly message: string };

/**
 * Check imported rule modules and return them sorted by ID. Pure, so the
 * registration rules are testable without touching the disk.
 */
export const validateRules = (modules: readonly RuleModule[]): Discovery => {
  const problems = modules.flatMap((m): readonly string[] => {
    const match = RULE_FILE.exec(m.fileName);
    if (match === null) {
      return [
        `${m.fileName}: not a rule file name (use eval004-short-slug.ts; put helpers outside rules/)`,
      ];
    }
    if (!isRule(m.exported)) {
      return [
        `${m.fileName}: must export \`rule\` as a Rule (id EVALnnn, severity error|warn|info, title, source, and checkCase and/or checkSuite)`,
      ];
    }
    const expected = (match[1] ?? "").toUpperCase();
    return m.exported.id === expected
      ? []
      : [`${m.fileName}: rule id is ${m.exported.id} but the file name says ${expected}`];
  });
  const rules = modules.flatMap((m) => (isRule(m.exported) ? [m.exported] : []));
  const seen = new Set<string>();
  const duplicates = rules.flatMap((r): readonly string[] => {
    if (seen.has(r.id)) return [`duplicate rule id ${r.id}`];
    seen.add(r.id);
    return [];
  });
  const all = [...problems, ...duplicates];
  return all.length > 0
    ? { ok: false, message: `invalid lint rules:\n  ${all.join("\n  ")}` }
    : { ok: true, rules: [...rules].sort((a, b) => a.id.localeCompare(b.id)) };
};

/** Import every rule file in `dir` (default: the plugin's `lint/rules/`) and validate them. */
export const discoverRules = async (
  dir: string = RULES_DIR,
): Promise<Discovery> => {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".test.ts"))
    .sort();
  try {
    const modules = await Promise.all(
      names.map(async (fileName): Promise<RuleModule> => {
        const mod: unknown = await import(pathToFileURL(join(dir, fileName)).href);
        return {
          fileName,
          exported: isRecord(mod) ? mod["rule"] : undefined,
        };
      }),
    );
    return validateRules(modules);
  } catch (e) {
    return {
      ok: false,
      message: `cannot load lint rules: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
};
