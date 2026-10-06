/**
 * The lint runner (#453): reads a plugin's eval suite with the shared parser,
 * runs every discovered rule over it, and returns findings. Free: no model
 * calls, no network. Output formatting lives here too so the CLI, the hook and
 * the case-reviewer agent all print the same thing.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  checkGrantCaseNames,
  getSchema,
  readGrantsFile,
  readPluginManifest,
  readSuite,
  resolveEvalDir,
  type EvalDirSource,
  type ParseIssue,
} from "../parser/index.ts";
import type { Finding, LintContext, Problem, Rule, Severity } from "./types.ts";

/** Rule ID used for files the parser could not read (bad YAML, wrong value type). Not a `Rule`. */
export const PARSE_RULE_ID = "PARSE";

export interface LintOptions {
  /** `--eval-dir`: wins over the manifest. */
  readonly evalDir?: string;
  /** `--grants`: the grants file; default `<eval dir>/grants.yaml`. */
  readonly grantsFile?: string;
}

export interface LintReport {
  readonly pluginRoot: string;
  readonly evalDir: string;
  readonly casesChecked: number;
  /** Claude Code version the schema table was written against. */
  readonly claudeCodeVersion: string;
  /** Sorted by file, line, then rule ID. */
  readonly findings: readonly Finding[];
}

export type LintOutcome =
  | { readonly ok: true; readonly report: LintReport }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly source: EvalDirSource;
    };

const parseFinding = (issue: ParseIssue): Finding => ({
  ruleId: PARSE_RULE_ID,
  severity: "error",
  message: `Cannot read this file: ${issue.message} (${issue.kind}).`,
  fix: "Fix the file so it parses; the rules cannot check what the parser could not read.",
  source: "the case files as written (parser issue, not a lint rule)",
  loc: issue.loc,
  caseDirName: undefined,
});

const toFinding = (
  rule: Rule,
  problem: Problem,
  caseDirName: string | undefined,
): Finding => ({
  ruleId: rule.id,
  severity: problem.severity ?? rule.severity,
  message: problem.message,
  fix: problem.fix,
  source: problem.source ?? rule.source,
  loc: problem.loc,
  caseDirName,
});

/** Run `check`, naming the rule if it throws (a throwing rule is a bug, not a finding). */
const guarded = (
  rule: Rule,
  check: () => readonly Problem[],
): readonly Problem[] => {
  try {
    return check();
  } catch (e) {
    throw new Error(
      `rule ${rule.id} threw: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
};

const bySeverity: Readonly<Record<Severity, number>> = {
  error: 0,
  warn: 1,
  info: 2,
};

const compareFindings = (a: Finding, b: Finding): number =>
  a.loc.file.localeCompare(b.loc.file) ||
  a.loc.line - b.loc.line ||
  (a.loc.column ?? 0) - (b.loc.column ?? 0) ||
  bySeverity[a.severity] - bySeverity[b.severity] ||
  a.ruleId.localeCompare(b.ruleId);

/** Run `rules` over the eval suite of the plugin at `pluginRoot`. */
export const lintPlugin = (
  pluginRoot: string,
  rules: readonly Rule[],
  options: LintOptions = {},
): LintOutcome => {
  const resolved = resolveEvalDir(
    pluginRoot,
    options.evalDir === undefined ? {} : { flag: options.evalDir },
  );
  if (!resolved.ok) {
    return { ok: false, reason: resolved.reason, source: resolved.source };
  }
  const suite = readSuite(
    pluginRoot,
    options.evalDir === undefined ? {} : { flag: options.evalDir },
  );
  const grants = checkGrantCaseNames(
    readGrantsFile(options.grantsFile ?? join(suite.evalDir, "grants.yaml")),
    suite.cases.map((c) => c.name.value),
  );
  const manifest = readPluginManifest(pluginRoot);
  const context: LintContext = {
    pluginRoot,
    schema: getSchema(),
    suite,
    grants,
    manifest,
  };

  const parseIssues: readonly ParseIssue[] = [
    ...suite.issues,
    ...suite.mocks.issues,
    ...suite.cases.flatMap((c) => c.issues),
    ...grants.issues,
    // A plugin root with no manifest is not this lint's business.
    ...(existsSync(manifest.file) ? manifest.issues : []),
  ];
  const ruleFindings = rules.flatMap((rule) => [
    ...suite.cases.flatMap((c) =>
      rule.checkCase === undefined
        ? []
        : guarded(rule, () => rule.checkCase?.(c, context) ?? []).map((p) =>
            toFinding(rule, p, c.dirName),
          ),
    ),
    ...(rule.checkSuite === undefined
      ? []
      : guarded(rule, () => rule.checkSuite?.(context) ?? []).map((p) =>
          toFinding(rule, p, undefined),
        )),
  ]);
  return {
    ok: true,
    report: {
      pluginRoot,
      evalDir: suite.evalDir,
      casesChecked: suite.cases.length,
      claudeCodeVersion: context.schema.claudeCodeVersion,
      findings: [...parseIssues.map(parseFinding), ...ruleFindings].sort(
        compareFindings,
      ),
    },
  };
};

/** Count findings of one severity. */
export const countSeverity = (
  report: LintReport,
  severity: Severity,
): number => report.findings.filter((f) => f.severity === severity).length;

const location = (f: Finding): string =>
  `${f.loc.file}:${String(f.loc.line)}${f.loc.column === undefined ? "" : `:${String(f.loc.column)}`}`;

/**
 * The text report. One block per finding: `file:line:col: severity RULE: what`,
 * then the fix and the source, then a summary line.
 */
export const formatText = (report: LintReport): string => {
  const blocks = report.findings.map(
    (f) =>
      `${location(f)}: ${f.severity} ${f.ruleId}: ${f.message}\n    Fix: ${f.fix}\n    Source: ${f.source}\n`,
  );
  const count = (s: Severity): string => String(countSeverity(report, s));
  const summary = `${count("error")} error(s), ${count("warn")} warning(s), ${count("info")} info across ${String(report.casesChecked)} case(s) in ${report.evalDir}`;
  return [
    `eval-authoring lint (schema written against Claude Code ${report.claudeCodeVersion})`,
    ...blocks,
    summary,
    "",
  ].join("\n");
};

/** The JSON report, for the hook and agents. */
export const formatJson = (report: LintReport): string =>
  `${JSON.stringify(
    {
      claudeCodeVersion: report.claudeCodeVersion,
      pluginRoot: report.pluginRoot,
      evalDir: report.evalDir,
      casesChecked: report.casesChecked,
      counts: {
        error: countSeverity(report, "error"),
        warn: countSeverity(report, "warn"),
        info: countSeverity(report, "info"),
      },
      findings: report.findings,
    },
    null,
    2,
  )}\n`;
