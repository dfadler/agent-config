import type { ArmStats, CaseVerdict, Diagnosis } from "./verdict.ts";

const arm = (s: ArmStats): string =>
  s.usedRuns === 0
    ? `none of ${String(s.runs)} runs usable`
    : `${String(s.mean)}${s.stdDev === undefined ? "" : ` (sd ${String(s.stdDev)})`} over ${String(s.usedRuns)}/${String(s.runs)} runs`;

const caseText = (c: CaseVerdict): string =>
  [
    `${c.name}: ${c.verdict}`,
    `  ${c.reason}`,
    `  delta: ${c.delta === undefined ? "no delta signal" : String(c.delta)}; with: ${arm(c.with)}; without: ${c.without.runs === 0 ? "no runs" : arm(c.without)}${c.scoredGraders === undefined ? "" : `; scored graders: ${String(c.scoredGraders)}`}`,
    ...c.findings.map((f) => `  [${f.severity}] ${f.kind}: ${f.message}`),
  ].join("\n");

/** Human-readable report: one block per case. */
export const formatText = (d: Diagnosis): string =>
  [
    ...(d.partial
      ? [
          `PARTIAL result${d.partialReason === undefined ? "" : `: ${d.partialReason}`}. Leave it out of trends.`,
        ]
      : []),
    ...d.cases.map(caseText),
  ].join("\n\n") + "\n";

/** Machine-readable report. */
export const formatJson = (d: Diagnosis): string =>
  JSON.stringify(d, null, 2) + "\n";
