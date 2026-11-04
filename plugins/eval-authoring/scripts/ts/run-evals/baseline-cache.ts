/**
 * Baseline cache (#855): the no-plugin arm loads no plugin, so a skill or agent edit
 * cannot change it. A two-arm run stores each case's without arm; a later run whose
 * key matches runs the case with `--ablation none` and `spliceResult` puts the stored
 * arm back into that run's aggregate-result.json, recomputing score and delta the way
 * a two-arm run scores them. Local only: the store sits under `evals/results/`, which
 * is gitignored and empty on a fresh CI checkout, so CI never hits it.
 *
 * Replaying 60 stored two-arm cases through `spliceResult` reproduces the CLI's own
 * score and delta exactly (baseline-cache.test.ts). What a cached delta cannot do is
 * redraw the baseline: it is one sample, reused, and the summary says so.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { implausibleReasons, silentZeroReasons } from "../parser/result.ts";
import { isRec, list, parse } from "./summary.ts";
import type { Io } from "./io.ts";

type Rec = Readonly<Record<string, unknown>>;
type FileIo = Pick<Io, "listDir" | "readFile">;

export const CACHE_DIR = ".baseline-cache";
const VERSION = 1;

/** One hash over every file under `root` (relative path and bytes, sorted); a missing root hashes as empty. */
export const hashTree = (io: FileIo, root: string): string => {
  const h = createHash("sha256");
  const walk = (dir: string, rel: string): void => {
    for (const name of [...io.listDir(dir)].sort()) {
      const p = join(dir, name);
      const text = io.readFile(p);
      if (text === undefined) walk(p, join(rel, name)); // a directory (or unreadable: hashes as empty)
      else h.update(`${join(rel, name)}\0${text}\0`);
    }
  };
  walk(root, "");
  return h.digest("hex");
};

/** Everything a without-arm run depends on. The plugin is not one: that arm loads none. */
export interface KeyParts {
  readonly caseName: string;
  /** The case directory: prompt, graders, `max_turns`, fixtures. */
  readonly caseHash: string;
  /** Suite-level mocks and the plugin's `.mcp.json`, which a case may reach. */
  readonly sharedHash: string;
  readonly grants: readonly string[];
  readonly runs: number;
  readonly threshold: number;
  readonly model: string;
  readonly judgeModel: string;
  readonly claudeVersion: string;
}

export const cacheKey = (k: KeyParts): string =>
  createHash("sha256")
    .update(JSON.stringify([VERSION, k.caseName, k.caseHash, k.sharedHash, [...k.grants].sort(), k.runs, k.threshold, k.model, k.judgeModel, k.claudeVersion]))
    .digest("hex")
    .slice(0, 16);

export interface CacheEntry {
  readonly key: string;
  readonly caseName: string;
  readonly savedAt: string;
  readonly claudeVersion: string;
  /** The `arms.without` runs of the case, as the CLI wrote them. */
  readonly without: readonly Rec[];
}

const entryFile = (dir: string, key: string): string => join(dir, `${key}.json`);

/** The stored entry for `key`, or undefined when absent, unreadable or not shaped like one. */
export const loadEntry = (io: FileIo, dir: string, key: string): CacheEntry | undefined => {
  const doc = parse(io.readFile(entryFile(dir, key)));
  const without = list(doc?.["without"]).filter(isRec);
  return doc !== undefined && doc["v"] === VERSION && doc["key"] === key && typeof doc["caseName"] === "string" && typeof doc["savedAt"] === "string" && typeof doc["claudeVersion"] === "string" && without.length > 0
    ? { key, caseName: doc["caseName"], savedAt: doc["savedAt"], claudeVersion: doc["claudeVersion"], without }
    : undefined;
};

export const saveEntry = (io: Pick<Io, "writeFile">, dir: string, e: CacheEntry): void => {
  io.writeFile(entryFile(dir, e.key), `${JSON.stringify({ v: VERSION, ...e }, null, 2)}\n`);
};

export type Extracted =
  | { readonly ok: true; readonly entry: CacheEntry }
  | { readonly ok: false; readonly reason: string };

/**
 * The without arm of a finished two-arm result, or why it is not worth keeping. Same bar as
 * save-baseline: a partial, errored, silent-zero or implausible run is not a baseline, and
 * neither is an arm with fewer runs than asked or with paid graders skipped.
 */
export const extractEntry = (text: string, caseName: string, key: string, claudeVersion: string, runs: number, now: Date): Extracted => {
  const doc = parse(text);
  if (doc === undefined) return { ok: false, reason: "result is not a JSON object" };
  const bad = [...implausibleReasons(doc), ...silentZeroReasons(doc), ...(doc["partial"] === true ? ["partial: true"] : [])];
  if (bad.length > 0) return { ok: false, reason: bad.join("; ") };
  const c = list(doc["cases"]).filter(isRec).find((x) => x["name"] === caseName);
  const arms = isRec(c?.["arms"]) ? c["arms"] : {};
  const without = list(arms["without"]).filter(isRec);
  const all = [...list(arms["with"]).filter(isRec), ...without];
  if (without.length === 0) return { ok: false, reason: "no without arm in the result" };
  if (without.length !== runs) return { ok: false, reason: `without arm has ${String(without.length)} runs, ${String(runs)} asked` };
  if (all.some((r) => typeof r["error"] === "string")) return { ok: false, reason: "errored runs" };
  if (all.some((r) => r["skippedPaidGraders"] === true)) return { ok: false, reason: "paid graders skipped" };
  return { ok: true, entry: { key, caseName, savedAt: now.toISOString(), claudeVersion, without } };
};

const mean = (xs: readonly number[]): number | undefined => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/** Weighted pass share of one run over the graders in `only`. */
const runScore = (run: Rec, only: ReadonlySet<string>): number | undefined => {
  const gs = list(run["graders"]).filter(isRec).filter((g) => only.has(String(g["name"])));
  const w = gs.reduce((a, g) => a + (num(g["weight"]) ?? 1), 0);
  return w === 0 ? undefined : gs.reduce((a, g) => a + (g["passed"] === true ? (num(g["weight"]) ?? 1) : 0), 0) / w;
};

const defined = (xs: readonly (number | undefined)[]): number[] => xs.filter((x): x is number => x !== undefined);
const share = (runs: readonly Rec[]): number | undefined => (runs.length === 0 ? undefined : runs.filter((r) => r["passed"] === true).length / runs.length);

/**
 * `text`: an `--ablation none` result (plugin arm only, nothing excluded from scoring).
 * The scored set is the graders the stored without arm lists: the CLI leaves a with-only
 * grader such as `skill_fired` out of that arm, so it stays out of both, as in a two-arm
 * run. Each plugin-arm run is rescored over that set and `passed` follows the threshold;
 * case and suite aggregates are recomputed. Cost fields are left alone: they are what this
 * run spent.
 */
export const spliceResult = (text: string, entry: CacheEntry): { readonly ok: true; readonly text: string; readonly belowThreshold: boolean } | { readonly ok: false; readonly reason: string } => {
  const doc = parse(text);
  if (doc === undefined) return { ok: false, reason: "result is not a JSON object" };
  const threshold = num(isRec(doc["suite"]) ? doc["suite"]["threshold"] : undefined) ?? 1;
  const scored = new Set(list(entry.without[0]?.["graders"]).filter(isRec).map((g) => String(g["name"])));
  if (scored.size === 0) return { ok: false, reason: "stored without arm lists no graders" };
  if (!list(doc["cases"]).some((c) => isRec(c) && c["name"] === entry.caseName)) {
    return { ok: false, reason: `no case named ${entry.caseName} in the result` };
  }
  const cases =list(doc["cases"]).filter(isRec).map((c) => {
    if (c["name"] !== entry.caseName) return c;
    const arms = isRec(c["arms"]) ? c["arms"] : {};
    const withRuns = list(arms["with"]).filter(isRec).map((r) => {
      const score = runScore(r, scored);
      return {
        ...r,
        ...(score === undefined ? {} : { score, passed: score >= threshold }),
        graders: list(r["graders"]).filter(isRec).map((g) => ({ ...g, scored: scored.has(String(g["name"])) })),
      };
    });
    const score = mean(defined(withRuns.map((r) => num(r["score"]))));
    const scoreWithout = mean(defined(entry.without.map((r) => num(r["score"]))));
    return {
      ...c,
      arms: { ...arms, with: withRuns, without: entry.without },
      aggregates: {
        ...(isRec(c["aggregates"]) ? c["aggregates"] : {}),
        score,
        passRate: share(withRuns),
        scoreWithout,
        passRateWithout: share(entry.without),
        delta: score === undefined || scoreWithout === undefined ? undefined : score - scoreWithout,
        baselineCached: true,
      },
    };
  });
  const agg = (k: string): (number | undefined)[] => cases.map((c) => num(isRec(c["aggregates"]) ? c["aggregates"][k] : undefined));
  const scores = defined(agg("score"));
  const out = {
    ...doc,
    cases,
    aggregates: {
      ...(isRec(doc["aggregates"]) ? doc["aggregates"] : {}),
      casesPassed: scores.filter((s) => s >= threshold).length,
      overallScore: mean(scores),
      overallPassRate: mean(defined(agg("passRate"))),
      meanDelta: mean(defined(agg("delta"))),
    },
    baselineCache: { key: entry.key, case: entry.caseName, savedAt: entry.savedAt, claudeVersion: entry.claudeVersion },
  };
  return { ok: true, text: `${JSON.stringify(out, null, 2)}\n`, belowThreshold: scores.some((s) => s < threshold) };
};

/**
 * The `--ablation none` run exited on its own all-graders score; a two-arm run would have scored
 * the spliced set. Exit 0 and 1 are re-derived from the spliced score; any other status
 * (2, 130, 143, a signal) says something the splice cannot, so it passes through.
 */
export const statusAfterSplice = (status: number | null, belowThreshold: boolean): number | null =>
  status === 0 || status === 1 ? (belowThreshold ? 1 : 0) : status;
