// Programmatic pre-grader for gha-ci-audit evals.
//
// Handles grep/file-check assertions without LLM tokens. Assertions that need
// language understanding get passed=null and evidence="requires_ai_grader" so
// the grader agent can fill them in.
//
// Usage: node grade.ts --output-dir <path/to/outputs> --grading-out <path/to/grading.json>
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { defaultIo, isObject, str, type Io, type Json } from "./common.ts";

const USAGE = "Usage: grade.ts --output-dir <outputs dir> --grading-out <grading.json>\n";

/** Where evals.json lives relative to this script: scripts/ts/gha-ci-audit -> evals/evals.json. */
export const DEFAULT_EVALS_PATH = join(import.meta.dirname, "..", "..", "..", "evals", "evals.json");

export interface Check {
  /** `null` means "needs the AI grader". */
  readonly passed: boolean | null;
  readonly evidence: string;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

const size = (path: string): number => {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
};

export const checkArtifactPublished = (dir: string): Check => {
  const report = join(dir, "report.html");
  if (!existsSync(report)) return { passed: false, evidence: "report.html not found in outputs directory" };
  const n = size(report);
  if (n < 1000) return { passed: false, evidence: `report.html exists but is only ${String(n)} bytes (< 1000)` };
  return { passed: true, evidence: `report.html exists and is ${String(n)} bytes` };
};

export const checkWorkflowCountFound = (dir: string): Check => {
  const wfText = readText(join(dir, "workflows.json"));
  if (wfText !== null && wfText !== "") {
    try {
      const data: unknown = JSON.parse(wfText);
      const count = Array.isArray(data) ? data.length : 0;
      if (count >= 2) return { passed: true, evidence: `workflows.json contains ${String(count)} entries` };
      if (count === 1) return { passed: false, evidence: `workflows.json contains only ${String(count)} entry (need >= 2)` };
    } catch {
      // Fall through to the report.html heuristic.
    }
  }
  const report = readText(join(dir, "report.html"));
  if (report === null || report === "") return { passed: false, evidence: "Neither workflows.json nor report.html found" };
  const rows = report.match(/<tr[^>]*>.*?<td[^>]*>[^<]{3,}<\/td>/gis)?.length ?? 0;
  if (rows >= 2) {
    return { passed: true, evidence: `report.html contains ${String(rows)} table rows (likely workflow entries)` };
  }
  return { passed: false, evidence: "Could not confirm 2+ workflows in workflows.json or report.html" };
};

export const checkFailureRate = (dir: string): Check => {
  const report = readText(join(dir, "report.html"));
  if (report === null || report === "") return { passed: false, evidence: "report.html not found" };

  // A percentage (or a 0.xx decimal) within ~200 chars of "fail"/"failure".
  const near = /fail(?:ure)?[^<]{0,200}?(\d{1,3}(?:\.\d+)?%|\b0\.\d{2,})\b|(\d{1,3}(?:\.\d+)?%|\b0\.\d{2,})\b[^<]{0,200}?fail(?:ure)?/i.exec(report);
  if (near !== null) {
    return { passed: true, evidence: `Failure rate value found in report.html: '${near[1] ?? near[2] ?? ""}'` };
  }

  // Broader: any % near "fail" in the text with tags stripped.
  const stripped = report.replace(/<[^>]+>/g, " ");
  const broad = /fail(?:ure)?[^.]{0,100}?\d{1,3}(?:\.\d+)?%|\d{1,3}(?:\.\d+)?%[^.]{0,100}?fail(?:ure)?/i.exec(stripped);
  if (broad !== null) {
    return { passed: true, evidence: `Failure-rate pattern found in report text: '${broad[0].slice(0, 80).trim()}'` };
  }
  return { passed: false, evidence: "No failure rate (% near 'failure') found in report.html" };
};

export const checkRankedOpportunities = (dir: string): Check => {
  const report = readText(join(dir, "report.html"));
  if (report === null || report === "") return { passed: false, evidence: "report.html not found" };

  const high = report.match(/sev-high/gi)?.length ?? 0;
  const med = report.match(/sev-med/gi)?.length ?? 0;
  const total = high + med;
  if (total >= 2) {
    return { passed: true, evidence: `Found ${String(high)} sev-high and ${String(med)} sev-med badges in report.html` };
  }
  if (total === 1) return { passed: false, evidence: `Only ${String(total)} severity badge found (need >= 2)` };

  // Fallback: opportunity cards without the CSS class.
  const cards =
    report.match(
      /(?:opportunity|recommendation|suggestion)[^<]{0,300}?(?:high|medium|low|critical)[^<]{0,300}?(?:save|reduce|improve)/gis,
    )?.length ?? 0;
  if (cards >= 2) {
    return { passed: true, evidence: `Found ${String(cards)} opportunity cards in report.html (no sev-* badges)` };
  }
  return { passed: false, evidence: "Could not find 2+ ranked opportunity cards (sev-high/sev-med) in report.html" };
};

export const checkDataFilesSaved = (dir: string): Check => {
  const runs = join(dir, "runs.json");
  const jobs = join(dir, "jobs.json");
  const missing = [runs, jobs].filter((p) => size(p) < 2).map((p) => (p === runs ? "runs.json" : "jobs.json"));
  if (missing.length > 0) return { passed: false, evidence: `Missing or empty: ${missing.join(", ")}` };
  return {
    passed: true,
    evidence: `runs.json (${String(size(runs))} bytes) and jobs.json (${String(size(jobs))} bytes) both exist`,
  };
};

export interface GradedAssertion {
  readonly text: string;
  readonly passed: boolean | null;
  readonly evidence: string;
}

/** Grade one assertion; IDs without a programmatic check defer to the AI grader. */
export const gradeAssertion = (id: string, text: string, outputsDir: string): GradedAssertion => {
  const check = ((): Check => {
    switch (id) {
      case "artifact_published":
        return checkArtifactPublished(outputsDir);
      case "workflow_count_found":
        return checkWorkflowCountFound(outputsDir);
      case "failure_rate_computed":
      case "failure_rate_quantified":
        return checkFailureRate(outputsDir);
      case "ranked_opportunities":
        return checkRankedOpportunities(outputsDir);
      case "data_files_saved":
        return checkDataFilesSaved(outputsDir);
      default:
        return { passed: null, evidence: "requires_ai_grader" };
    }
  })();
  return { text, passed: check.passed, evidence: check.evidence };
};

const readJsonObject = (path: string): Json | null => {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isObject(data) ? data : null;
  } catch {
    return null;
  }
};

export const main = (argv: string[], io: Io = defaultIo, evalsPath: string = DEFAULT_EVALS_PATH): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        "output-dir": { type: "string" },
        "grading-out": { type: "string" },
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
  const { "output-dir": outDir, "grading-out": gradingOut } = parsed.values;
  if (outDir === undefined || gradingOut === undefined) {
    io.err(`--output-dir and --grading-out are required\n${USAGE}`);
    return 2;
  }
  const outputsDir = resolve(outDir);
  const gradingPath = resolve(gradingOut);

  const evalsData = readJsonObject(evalsPath);
  if (evalsData === null) {
    io.err(`error: cannot read ${evalsPath}\n`);
    return 1;
  }
  // The eval id comes from eval_metadata.json next to outputs/; fall back to the first eval.
  const meta = readJsonObject(join(dirname(outputsDir), "eval_metadata.json"));
  const evalId = meta?.["eval_id"];
  const all = (Array.isArray(evalsData["evals"]) ? evalsData["evals"] : []).filter(isObject);
  const entry = all.find((e) => e["id"] === evalId) ?? all[0] ?? {};
  const specs = (Array.isArray(entry["assertions"]) ? entry["assertions"] : []).filter(isObject);

  const graded = specs.map((s) => gradeAssertion(str(s["id"]) ?? "", str(s["text"]) ?? "", outputsDir));
  const decided = graded.filter((a) => a.passed !== null);
  const passedCount = decided.filter((a) => a.passed === true).length;
  const failedCount = decided.length - passedCount;
  const aiCount = graded.length - decided.length;

  const output = {
    assertions: graded,
    // Stays null until the AI grader resolves every deferred entry.
    overall_passed: null,
    summary: `${String(passedCount)} passed, ${String(failedCount)} failed programmatically; ${String(aiCount)} require AI grading`,
  };
  mkdirSync(dirname(gradingPath), { recursive: true });
  writeFileSync(gradingPath, JSON.stringify(output, null, 2));
  io.out(
    `grade.ts: wrote ${gradingPath} — ${String(passedCount)} passed, ${String(failedCount)} failed, ${String(aiCount)} deferred to AI\n`,
  );
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
