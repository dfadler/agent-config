/** Reader for `aggregate-result.json` (`schemaVersion: 1`, camelCase). */
import type {
  AggregateResult,
  CaseAggregates,
  CaseResult,
  GraderResult,
  ReadResultOutcome,
  RunResult,
} from "./types.ts";

/** The `schemaVersion` this reader understands. */
export const RESULT_SCHEMA_VERSION = 1;

type Rec = Readonly<Record<string, unknown>>;

const isRec = (v: unknown): v is Rec =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const arr = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);
const optStr = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;
const optNum = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const optBool = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

/** A run's `error`: a string, `null` for none, or an object whose message is kept. */
const errorOf = (v: unknown): string | null | undefined => {
  if (v === null) return null;
  if (typeof v === "string") return v;
  if (isRec(v)) return optStr(v["message"]) ?? JSON.stringify(v);
  return undefined;
};

const readGrader = (g: Rec): GraderResult => {
  const name = optStr(g["name"]);
  const type = optStr(g["type"]);
  const passed = optBool(g["passed"]);
  const score = optNum(g["score"]);
  const scored = optBool(g["scored"]);
  return {
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    ...(passed === undefined ? {} : { passed }),
    ...(score === undefined ? {} : { score }),
    ...(scored === undefined ? {} : { scored }),
  };
};

const readRun = (r: Rec): RunResult => {
  const score = optNum(r["score"]);
  const error = errorOf(r["error"]);
  const aborted = optBool(r["aborted"]);
  const skipped = optBool(r["skippedPaidGraders"]);
  const graders = Array.isArray(r["graders"])
    ? arr(r["graders"]).filter(isRec).map(readGrader)
    : undefined;
  return {
    ...(score === undefined ? {} : { score }),
    ...(error === undefined ? {} : { error }),
    ...(aborted === undefined ? {} : { aborted }),
    ...(skipped === undefined ? {} : { skippedPaidGraders: skipped }),
    ...(graders === undefined ? {} : { graders }),
  };
};

const readCaseResult = (c: Rec): CaseResult => {
  const aggregates = isRec(c["aggregates"]) ? c["aggregates"] : {};
  const delta = optNum(aggregates["delta"]);
  const arms = isRec(c["arms"]) ? c["arms"] : {};
  const outAggregates: CaseAggregates =
    delta === undefined ? {} : { delta };
  return {
    name: optStr(c["name"]) ?? "",
    aggregates: outAggregates,
    withRuns: arr(arms["with"]).filter(isRec).map(readRun),
    withoutRuns: arr(arms["without"]).filter(isRec).map(readRun),
  };
};

/**
 * Parse `aggregate-result.json` text (`schemaVersion: 1`, camelCase). Ignores
 * unknown fields and tolerates an omitted `delta`. An unreadable or unsupported
 * document is reported, not thrown. Used by the diagnosis script (#462) and
 * the #436 Δ gate.
 */
export const readAggregateResult = (text: string): ReadResultOutcome => {
  const doc = ((): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();
  if (!isRec(doc)) {
    return { ok: false, reason: "not a JSON object" };
  }
  const version = doc["schemaVersion"];
  if (version !== RESULT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported schemaVersion ${version === undefined ? "(missing)" : JSON.stringify(version)} (expected ${String(RESULT_SCHEMA_VERSION)})`,
    };
  }
  if (!Array.isArray(doc["cases"])) {
    return { ok: false, reason: "missing cases array" };
  }
  const result: AggregateResult = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    partial: doc["partial"] === true,
    partialReason: optStr(doc["partialReason"]),
    cases: arr(doc["cases"]).filter(isRec).map(readCaseResult),
  };
  return { ok: true, result };
};
