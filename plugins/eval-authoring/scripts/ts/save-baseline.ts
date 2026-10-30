/**
 * Hand-run (#738, option C): read a finished run's results and write a compact
 * per-plugin baseline summary, so a score of record can be committed by hand.
 * No workflow, no secret, no network. `node save-baseline.ts --help`.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { diagnose } from "./diagnose/verdict.ts";
import { implausibleReasons, isErrored, readAggregateResult, silentZeroReasons } from "./parser/result.ts";
import type { AggregateResult } from "./parser/index.ts";
import { isRec, list, parse } from "./run-evals/summary.ts";

const USAGE = `Usage: save-baseline.ts [-h|--help] [--out FILE] [--force] [--tier NAME] [--plugin NAME] RESULTS

Write a compact baseline summary from a finished run: plugin, date, plugin
version, tier, model and judge model, mean with-plugin score, mean without-plugin
score, mean delta, pass^k (share of cases whose with-plugin runs all scored 1)
and per-case with/without scores. Reads results only; runs nothing, costs nothing.

  RESULTS       A run directory (every aggregate-result.json under it is merged,
                run-evals-summary.json beside them supplies the tier) or one
                aggregate-result.json.
  --out FILE    Where to write. Default: docs/eval-baselines/<plugin>.json
                relative to the current directory. For one file per release use
                e.g. docs/eval-baselines/<plugin>-v1.0.0.json.
  --force       Overwrite FILE when it exists. Without it an existing file is an error.
  --tier NAME   Tier to record when RESULTS has no run-evals-summary.json.
  --plugin NAME The plugin measured; needed when the result lists several loaded
                plugins and there is no run-evals-summary.json to name it.

Refuses a run that is partial, errored, silent-zero or implausible: such numbers
are not a baseline. Exit 0 written, 1 refused, 2 usage.
`;

export interface Io {
  readonly readFile: (path: string) => string | undefined;
  /** aggregate-result.json paths under `path`, or `[path]` for a file; empty when missing. */
  readonly findResults: (path: string) => readonly string[];
  readonly exists: (path: string) => boolean;
  readonly writeFile: (path: string, text: string) => void;
  readonly now: () => Date;
}

export interface Outcome {
  readonly code: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4;
const mean = (xs: readonly number[]): number | null =>
  xs.length === 0 ? null : round(xs.reduce((a, b) => a + b, 0) / xs.length);

interface Meta {
  readonly plugin: string;
  readonly version: string | null;
  readonly model: string | null;
  readonly judgeModel: string | null;
  readonly startedAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** `suite` metadata of one raw result; `wanted` (the wrapper's plugin) picks among several plugins. */
const metaOf = (doc: Readonly<Record<string, unknown>>, wanted: string | undefined): Meta | undefined => {
  const suite = isRec(doc["suite"]) ? doc["suite"] : {};
  const plugins = list(suite["plugins"]).filter(isRec);
  // Several plugins are loaded (companions): never guess which one this run measures.
  const p = wanted === undefined ? (plugins.length === 1 ? plugins[0] : undefined) : plugins.find((x) => x["name"] === wanted);
  const plugin = p === undefined ? null : str(p["name"]);
  return p === undefined || plugin === null
    ? undefined
    : {
        plugin,
        version: str(p["version"]),
        model: str(suite["modelOverride"]),
        judgeModel: str(suite["judgeModel"]),
        startedAt: str(doc["startedAt"]),
      };
};

const sameMeta = (a: Meta, b: Meta): boolean =>
  a.plugin === b.plugin && a.version === b.version && a.model === b.model && a.judgeModel === b.judgeModel;

export interface Baseline {
  readonly plugin: string;
  readonly date: string;
  readonly pluginVersion: string | null;
  readonly tier: string | null;
  readonly model: string | null;
  readonly judgeModel: string | null;
  readonly meanWithScore: number | null;
  readonly meanWithoutScore: number | null;
  readonly meanDelta: number | null;
  readonly passK: number | null;
  readonly cases: readonly {
    readonly name: string;
    readonly with: number | null;
    readonly without: number | null;
    readonly delta: number | null;
  }[];
}

/** Pure core: raw result texts in, a baseline or the reasons to refuse out. */
export const buildBaseline = (
  texts: readonly string[],
  tier: string | null,
  wantedPlugin: string | undefined,
  now: Date,
): { readonly ok: true; readonly baseline: Baseline } | { readonly ok: false; readonly reasons: readonly string[] } => {
  const docs = texts.map((t) => parse(t));
  const reasons: string[] = [];
  const metas: Meta[] = [];
  const cases: AggregateResult["cases"][number][] = [];
  docs.forEach((doc, i) => {
    const label = `result ${String(i + 1)}`;
    if (doc === undefined) return void reasons.push(`${label}: not a JSON object`);
    const bad = [...implausibleReasons(doc), ...silentZeroReasons(doc), ...(doc["partial"] === true ? ["partial: true"] : [])];
    const read = readAggregateResult(texts[i] ?? "");
    if (!read.ok || bad.length > 0) return void reasons.push(`${label}: ${bad.join("; ") || (read.ok ? "" : read.reason)}`);
    const errored = read.result.cases.filter((c) => [...c.withRuns, ...c.withoutRuns].some(isErrored));
    if (errored.length > 0) reasons.push(`${label}: errored runs in ${errored.map((c) => c.name).join(", ")}`);
    const meta = metaOf(doc, wantedPlugin);
    if (meta === undefined) reasons.push(`${label}: cannot tell which plugin it measures (pass --plugin NAME)`);
    else metas.push(meta);
    cases.push(...read.result.cases);
  });
  const first = metas[0];
  if (first !== undefined && metas.some((m) => !sameMeta(first, m))) {
    reasons.push("results disagree on plugin, version, model or judge model");
  }
  if (reasons.length > 0 || first === undefined) return { ok: false, reasons: reasons.length > 0 ? reasons : ["no results"] };
  const verdicts = diagnose({ schemaVersion: 1, partial: false, partialReason: undefined, cases }).cases;
  const withScores = cases.map((c) => c.withRuns.flatMap((r) => (r.score === undefined ? [] : [r.score])));
  const scored = withScores.filter((s) => s.length > 0);
  const startedAt = metas.flatMap((m) => (m.startedAt === null ? [] : [m.startedAt])).sort()[0];
  const nums = (xs: readonly (number | undefined)[]): number[] => xs.filter((x): x is number => x !== undefined);
  return {
    ok: true,
    baseline: {
      plugin: first.plugin,
      date: (startedAt ?? now.toISOString()).slice(0, 10),
      pluginVersion: first.version,
      tier,
      model: first.model,
      judgeModel: first.judgeModel,
      meanWithScore: mean(nums(verdicts.map((v) => v.with.mean))),
      meanWithoutScore: mean(nums(verdicts.map((v) => v.without.mean))),
      meanDelta: mean(nums(verdicts.map((v) => v.delta))),
      passK: scored.length === 0 ? null : round(scored.filter((s) => s.every((x) => x >= 1)).length / scored.length),
      cases: verdicts.map((v) => ({
        name: v.name,
        with: v.with.mean === undefined ? null : round(v.with.mean),
        without: v.without.mean === undefined ? null : round(v.without.mean),
        delta: v.delta === undefined ? null : round(v.delta),
      })),
    },
  };
};

const fail = (code: 1 | 2, message: string): Outcome => ({
  code,
  stdout: "",
  stderr: code === 2 ? `${message}\n\n${USAGE}` : `${message}\n`,
});

export const main = (argv: readonly string[], io: Io): Outcome => {
  if (argv.includes("-h") || argv.includes("--help")) return { code: 0, stdout: USAGE, stderr: "" };
  const valued = new Map<string, string>();
  const rest: string[] = [];
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--force") force = true;
    else if (a === "--out" || a === "--tier" || a === "--plugin") {
      const v = argv[++i];
      if (v === undefined) return fail(2, `${a} needs a value`);
      valued.set(a, v);
    } else if (a.startsWith("-")) return fail(2, `unknown option ${a}`);
    else rest.push(a);
  }
  const [input, ...extra] = rest;
  if (input === undefined || extra.length > 0) return fail(2, "expected exactly one RESULTS path");
  const files = io.findResults(input);
  if (files.length === 0) return fail(1, `no aggregate-result.json at ${input}`);
  const texts = files.map((f) => io.readFile(f));
  const unreadable = files.filter((_, i) => texts[i] === undefined);
  if (unreadable.length > 0) return fail(1, `cannot read ${unreadable.join(", ")}`);
  // The wrapper's summary names the tier and the plugin; absent for a bare result file.
  const summary = parse(io.readFile(join(files.length === 1 && files[0] === input ? dirname(input) : input, "run-evals-summary.json")));
  const built = buildBaseline(
    texts.map((t) => t ?? ""),
    valued.get("--tier") ?? str(summary?.["tier"]),
    valued.get("--plugin") ?? str(summary?.["plugin"]) ?? undefined,
    io.now(),
  );
  if (!built.ok) return fail(1, `refusing to write a baseline:\n- ${built.reasons.join("\n- ")}`);
  const b = built.baseline;
  if (!/^[\w.-]+$/.test(b.plugin)) return fail(1, `plugin name '${b.plugin}' is not a safe file name`);
  const out = valued.get("--out") ?? join("docs", "eval-baselines", `${b.plugin}.json`);
  if (io.exists(out) && !force) return fail(1, `${out} exists; pass --force to overwrite`);
  io.writeFile(out, `${JSON.stringify(b, null, 2)}\n`);
  return { code: 0, stdout: `wrote ${out} (${b.plugin}, ${String(b.cases.length)} cases)\n`, stderr: "" };
};

const nodeIo: Io = {
  readFile: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return undefined;
    }
  },
  findResults: (p) => {
    if (!existsSync(p)) return [];
    return statSync(p).isDirectory()
      ? readdirSync(p, { recursive: true, encoding: "utf8" })
          .filter((f) => f.endsWith("aggregate-result.json"))
          .sort()
          .map((f) => join(p, f))
      : [p];
  },
  exists: existsSync,
  writeFile: (p, text) => {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  },
  now: () => new Date(),
};

if (import.meta.main) {
  const out = main(process.argv.slice(2), nodeIo);
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}
