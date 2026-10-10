// Aggregate grading results from an eval iteration into benchmark.json.
//
// Expected layout (gha-ci-audit workspace):
//   <iteration_dir>/<eval_name>/with_skill/{eval_metadata.json, grading.json,
//   timing.json (optional), outputs/report.html}
//
// Usage: node aggregate.ts <iteration_dir> [--skill-name NAME] [--skill-path P] [--model MODEL] [--output FILE]
// Writes <iteration_dir>/benchmark.json and benchmark.md.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { defaultIo, fmt, isObject, mean, type Io, type Json } from "./common.ts";

const USAGE = "Usage: aggregate.ts <iteration_dir> [--skill-name NAME] [--skill-path PATH] [--model MODEL] [--output FILE]\n";

export interface Stats {
  readonly mean: number;
  readonly stddev: number;
  readonly min: number;
  readonly max: number;
}

export interface Run {
  readonly eval_id: number;
  readonly eval_name: string;
  readonly configuration: string;
  readonly pass_rate: number;
  readonly passed: number;
  readonly failed: number;
  readonly total: number;
  readonly time_seconds: number;
  readonly tokens: number;
  readonly tool_calls: number;
  readonly errors: number;
  readonly expectations: unknown;
  readonly notes: readonly unknown[];
}

const round4 = (x: number): number => Number(fmt(x, 4));

export const stats = (values: readonly number[]): Stats => {
  if (values.length === 0) return { mean: 0, stddev: 0, min: 0, max: 0 };
  const m = mean(values);
  const sd = values.length > 1 ? Math.sqrt(values.reduce((a, x) => a + (x - m) ** 2, 0) / (values.length - 1)) : 0;
  return { mean: round4(m), stddev: round4(sd), min: round4(Math.min(...values)), max: round4(Math.max(...values)) };
};

const num = (v: unknown, dflt = 0): number => (typeof v === "number" ? v : dflt);
const obj = (v: unknown): Json => (isObject(v) ? v : {});

const readObject = (path: string): Json | null => {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isObject(data) ? data : null;
  } catch {
    return null;
  }
};

/** One graded run, or `null` when it has no (readable) grading.json. */
export const loadRun = (runDir: string, warn: (s: string) => void): Run | null => {
  const gradingPath = join(runDir, "grading.json");
  if (!existsSync(gradingPath)) return null;
  const grading = readObject(gradingPath);
  if (grading === null) {
    warn(`Warning: bad JSON in ${gradingPath}\n`);
    return null;
  }
  const meta = readObject(join(runDir, "eval_metadata.json"));
  const summary = obj(grading["summary"]);
  const metrics = obj(grading["execution_metrics"]);
  const timing = readObject(join(runDir, "timing.json"));

  let timeSeconds = num(timing?.["total_duration_seconds"]);
  if (timeSeconds === 0) timeSeconds = num(obj(grading["timing"])["total_duration_seconds"]);

  const notesSummary = obj(grading["user_notes_summary"]);
  const notes = ["uncertainties", "needs_review", "workarounds"].flatMap((k) => {
    const v = notesSummary[k];
    const items: unknown[] = Array.isArray(v) ? v : [];
    return items;
  });

  return {
    eval_id: num(meta?.["eval_id"]),
    eval_name: typeof meta?.["eval_name"] === "string" ? meta["eval_name"] : basename(dirname(runDir)),
    configuration: basename(runDir),
    pass_rate: num(summary["pass_rate"]),
    passed: num(summary["passed"]),
    failed: num(summary["failed"]),
    total: num(summary["total"]),
    time_seconds: timeSeconds,
    tokens: num(timing?.["total_tokens"]),
    tool_calls: num(metrics["total_tool_calls"]),
    errors: num(metrics["errors_encountered"]),
    expectations: Array.isArray(grading["expectations"]) ? grading["expectations"] : [],
    notes,
  };
};

export const loadAll = (iterationDir: string, warn: (s: string) => void): Run[] =>
  readdirSync(iterationDir)
    .sort()
    .flatMap((name) => {
      const evalDir = join(iterationDir, name);
      const runDir = join(evalDir, "with_skill");
      if (!statSync(evalDir).isDirectory() || !existsSync(runDir)) return [];
      const run = loadRun(runDir, warn);
      if (run === null) warn(`Warning: no grading.json in ${runDir}\n`);
      return run === null ? [] : [run];
    });

export const aggregate = (runs: readonly Run[]): { with_skill: { pass_rate: Stats; time_seconds: Stats; tokens: Stats } } => ({
  with_skill: {
    pass_rate: stats(runs.map((r) => r.pass_rate)),
    time_seconds: stats(runs.map((r) => r.time_seconds)),
    tokens: stats(runs.map((r) => r.tokens)),
  },
});

const noNotes: string[] = [];

export const generateBenchmark = (runs: readonly Run[], skillName: string, skillPath: string, model: string, now: Date) => ({
  metadata: {
    skill_name: skillName,
    skill_path: skillPath,
    executor_model: model,
    analyzer_model: model,
    timestamp: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    evals_run: [...new Set(runs.map((r) => r.eval_id))].sort((a, b) => a - b),
    runs_per_configuration: runs.filter((r) => r.configuration === "with_skill").length,
  },
  runs: runs.map((r) => ({
    eval_id: r.eval_id,
    eval_name: r.eval_name,
    configuration: r.configuration,
    run_number: 1,
    result: {
      pass_rate: r.pass_rate,
      passed: r.passed,
      failed: r.failed,
      total: r.total,
      time_seconds: r.time_seconds,
      tokens: r.tokens,
      tool_calls: r.tool_calls,
      errors: r.errors,
    },
    expectations: r.expectations,
    notes: r.notes,
  })),
  run_summary: aggregate(runs),
  notes: noNotes,
});

export type Benchmark = ReturnType<typeof generateBenchmark>;

export const generateMarkdown = (b: Benchmark): string => {
  const ws = b.run_summary.with_skill;
  const pct = (s: Stats): string => `${fmt(s.mean * 100, 0)}% ± ${fmt(s.stddev * 100, 0)}%`;
  const plain = (s: Stats): string => `${fmt(s.mean, 1)} ± ${fmt(s.stddev, 1)}`;
  const lines = [
    `# Benchmark: ${b.metadata.skill_name}`,
    "",
    `**Date**: ${b.metadata.timestamp}  **Model**: ${b.metadata.executor_model}`,
    `**Evals**: ${b.metadata.evals_run.join(", ")}`,
    "",
    "## Summary",
    "",
    "| Metric | With Skill |",
    "|--------|-----------|",
    `| Pass Rate | ${pct(ws.pass_rate)} |`,
    `| Time (s)  | ${plain(ws.time_seconds)} |`,
    `| Tokens    | ${plain(ws.tokens)} |`,
    "",
    "## Per-eval results",
    "",
    ...b.runs.map(
      (run) =>
        `- **${run.eval_name}** (${run.configuration}): ${fmt(run.result.pass_rate * 100, 0)}% ` +
        `(${String(run.result.passed)}/${String(run.result.total)}) — ${fmt(run.result.time_seconds, 0)}s`,
    ),
  ];
  if (b.notes.length > 0) lines.push("", "## Notes", "", ...b.notes.map((n) => `- ${n}`));
  return lines.join("\n");
};

export const main = (argv: string[], io: Io = defaultIo, now: Date = new Date()): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "skill-name": { type: "string", default: "gha-ci-audit" },
        "skill-path": { type: "string", default: "skills/gha-ci-audit" },
        model: { type: "string", default: "claude-sonnet-4-6" },
        output: { type: "string", short: "o" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help === true) {
    io.out(USAGE);
    return 0;
  }
  const [iterationDir, ...extra] = parsed.positionals;
  if (iterationDir === undefined || extra.length > 0) {
    io.err(USAGE);
    return 2;
  }
  if (!existsSync(iterationDir)) {
    io.err(`Not found: ${iterationDir}\n`);
    return 1;
  }
  const runs = loadAll(iterationDir, io.err);
  if (runs.length === 0) {
    io.err("No graded runs found.\n");
    return 1;
  }
  const benchmark = generateBenchmark(runs, parsed.values["skill-name"], parsed.values["skill-path"], parsed.values.model, now);
  const outJson = parsed.values.output ?? join(iterationDir, "benchmark.json");
  const outMd = outJson.replace(/\.[^./\\]*$/, "") + ".md";
  writeFileSync(outJson, JSON.stringify(benchmark, null, 2));
  writeFileSync(outMd, generateMarkdown(benchmark));
  io.out(`Generated: ${outJson}\nGenerated: ${outMd}\n\nPass rate: ${fmt(benchmark.run_summary.with_skill.pass_rate.mean * 100, 1)}%\n`);
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
