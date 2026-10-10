// Check the status of an eval iteration: what has outputs, what's been
// graded, what's still missing.
//
// Usage: node check-status.ts <iteration_dir>
//
// Prints one row per eval run (outputs present, graded, timing saved) and
// exits 1 if any run is incomplete.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { defaultIo, isObject, type Io } from "./common.ts";

const CHECKMARK = "✓";
const CROSS = "✗";
const DASH = "—";

export interface RunStatus {
  readonly hasMetadata: boolean;
  readonly hasOutputs: boolean;
  readonly hasReport: boolean;
  readonly hasGrading: boolean;
  readonly hasTiming: boolean;
  readonly passRate: number | null;
  readonly complete: boolean;
}

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

export const checkRun = (runDir: string): RunStatus => {
  const outputs = join(runDir, "outputs");
  const hasOutputsDir = isDir(outputs);
  const hasReport = hasOutputsDir && existsSync(join(outputs, "report.html"));
  const gradingPath = join(runDir, "grading.json");
  const hasGrading = existsSync(gradingPath);
  let passRate: number | null = null;
  if (hasGrading) {
    try {
      const g: unknown = JSON.parse(readFileSync(gradingPath, "utf8"));
      const summary = isObject(g) ? g["summary"] : undefined;
      const rate = isObject(summary) ? summary["pass_rate"] : undefined;
      passRate = typeof rate === "number" ? rate : null;
    } catch {
      // Unreadable grading.json: the run is still "graded", just without a rate.
    }
  }
  return {
    hasMetadata: existsSync(join(runDir, "eval_metadata.json")),
    hasOutputs: hasOutputsDir && readdirSync(outputs).length > 0,
    hasReport,
    hasGrading,
    hasTiming: existsSync(join(runDir, "timing.json")),
    passRate,
    complete: hasReport && hasGrading,
  };
};

/** Python's `f"{rate:.0%}"`: round-half-even to a whole percent. */
const percent = (rate: number): string => {
  const x = rate * 100;
  const f = Math.floor(x);
  const frac = x - f;
  const r = frac > 0.5 || (frac === 0.5 && f % 2 === 1) ? f + 1 : f;
  return `${String(r)}%`;
};

export const main = (argv: string[], io: Io = defaultIo): number => {
  const [dir, ...rest] = argv;
  if (dir === undefined || rest.length > 0) {
    io.err("Usage: check-status.ts <iteration_dir>\n");
    return 1;
  }
  if (!existsSync(dir)) {
    io.err(`Not found: ${dir}\n`);
    return 1;
  }
  const evalDirs = readdirSync(dir)
    .sort()
    .filter((d) => isDir(join(dir, d)) && existsSync(join(dir, d, "with_skill")));
  if (evalDirs.length === 0) {
    io.out(`No eval directories found in ${dir}\n`);
    return 0;
  }

  const out: string[] = [
    "",
    `${"Eval".padEnd(25)} ${"Cond".padEnd(14)} ${"Metadata".padEnd(10)} ${"Report".padEnd(8)} ${"Graded".padEnd(8)} ${"Timing".padEnd(8)} PassRate`,
    "-".repeat(90),
  ];
  let anyIncomplete = false;
  for (const name of evalDirs) {
    const runDir = join(dir, name, "with_skill");
    const s = checkRun(runDir);
    const yes = (b: boolean): string => (b ? CHECKMARK : CROSS);
    out.push(
      `  ${name.padEnd(23)} ${"with_skill".padEnd(14)} ` +
        `${yes(s.hasMetadata).padEnd(10)} ${yes(s.hasReport).padEnd(8)} ${yes(s.hasGrading).padEnd(8)} ` +
        `${(s.hasTiming ? CHECKMARK : DASH).padEnd(8)} ${s.passRate === null ? DASH : percent(s.passRate)}`,
    );
    if (!s.complete) anyIncomplete = true;
  }
  const graded = evalDirs.filter((n) => existsSync(join(dir, n, "with_skill", "grading.json"))).length;
  out.push(
    "",
    `Graded: ${String(graded)}/${String(evalDirs.length)} runs    benchmark.json: ${existsSync(join(dir, "benchmark.json")) ? CHECKMARK : CROSS}`,
    "",
    anyIncomplete ? "⚠  Some runs are incomplete. See above." : "All runs complete.",
  );
  io.out(out.join("\n") + "\n");
  return anyIncomplete ? 1 : 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
