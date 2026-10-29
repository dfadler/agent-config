/** Reader for `aggregate-result.json` (`schemaVersion: 1`, camelCase). */
import { keywordTarget } from "./case.ts";
import type {
  AggregateResult,
  CaseAggregates,
  CaseGraderDef,
  CaseResult,
  GraderResult,
  GraderTarget,
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
  const weight = optNum(g["weight"]);
  const explanation = optStr(g["explanation"]);
  const withOnly = optBool(g["withOnly"]);
  const votes = Array.isArray(g["judgeVotes"])
    ? arr(g["judgeVotes"]).filter((v): v is boolean => typeof v === "boolean")
    : undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    ...(passed === undefined ? {} : { passed }),
    ...(score === undefined ? {} : { score }),
    ...(scored === undefined ? {} : { scored }),
    ...(weight === undefined ? {} : { weight }),
    ...(explanation === undefined ? {} : { explanation }),
    ...(votes === undefined ? {} : { judgeVotes: votes }),
    ...(withOnly === undefined ? {} : { withOnly }),
  };
};

/** A written `target`/`focus`: a keyword, a `{source: file, path}` mapping, or `unknown`. */
const targetOf = (v: unknown): GraderTarget | undefined => {
  if (typeof v === "string") return keywordTarget(v);
  if (!isRec(v)) return undefined;
  const path = optStr(v["path"]);
  return v["source"] === "file" && path !== undefined
    ? { kind: "file", path }
    : { kind: "unknown", raw: JSON.stringify(v) };
};

/** A case-level grader definition; an absent `target`/`focus` is `last_message` for regex and llm. */
const readGraderDef = (g: Rec): CaseGraderDef => {
  const name = optStr(g["name"]);
  const type = optStr(g["type"]);
  const config = isRec(g["config"]) ? g["config"] : {};
  const target =
    targetOf(config["target"]) ??
    targetOf(config["focus"]) ??
    (type === "regex" || type === "llm" ? keywordTarget("last_message") : undefined);
  const match = optStr(config["match"]);
  const max = optNum(config["max"]);
  const exists = optBool(config["exists"]);
  return {
    ...(name === undefined ? {} : { name }),
    ...(type === undefined ? {} : { type }),
    ...(target === undefined ? {} : { target }),
    ...(match === undefined ? {} : { match }),
    ...(max === undefined ? {} : { max }),
    ...(exists === undefined ? {} : { exists }),
  };
};

const readRun = (r: Rec): RunResult => {
  const score = optNum(r["score"]);
  const error = errorOf(r["error"]);
  const aborted = optBool(r["aborted"]);
  const skipped = optBool(r["skippedPaidGraders"]);
  const turns = optNum(r["turns"]);
  const graders = Array.isArray(r["graders"])
    ? arr(r["graders"]).filter(isRec).map(readGrader)
    : undefined;
  return {
    ...(score === undefined ? {} : { score }),
    ...(error === undefined ? {} : { error }),
    ...(aborted === undefined ? {} : { aborted }),
    ...(skipped === undefined ? {} : { skippedPaidGraders: skipped }),
    ...(turns === undefined ? {} : { turns }),
    ...(graders === undefined ? {} : { graders }),
  };
};

const readCaseResult = (c: Rec): CaseResult => {
  const aggregates = isRec(c["aggregates"]) ? c["aggregates"] : {};
  const delta = optNum(aggregates["delta"]);
  const arms = isRec(c["arms"]) ? c["arms"] : {};
  const score = optNum(aggregates["score"]);
  const passRate = optNum(aggregates["passRate"]);
  const scoreWithout = optNum(aggregates["scoreWithout"]);
  const passRateWithout = optNum(aggregates["passRateWithout"]);
  const outAggregates: CaseAggregates = {
    ...(delta === undefined ? {} : { delta }),
    ...(score === undefined ? {} : { score }),
    ...(passRate === undefined ? {} : { passRate }),
    ...(scoreWithout === undefined ? {} : { scoreWithout }),
    ...(passRateWithout === undefined ? {} : { passRateWithout }),
  };
  const maxTurns = optNum(c["maxTurns"]);
  const graders = Array.isArray(c["graders"])
    ? arr(c["graders"]).filter(isRec).map(readGraderDef)
    : undefined;
  return {
    name: optStr(c["name"]) ?? "",
    aggregates: outAggregates,
    ...(maxTurns === undefined ? {} : { maxTurns }),
    ...(graders === undefined ? {} : { graders }),
    withRuns: arr(arms["with"]).filter(isRec).map(readRun),
    withoutRuns: arr(arms["without"]).filter(isRec).map(readRun),
  };
};

/** A run that errored: any string `error` counts, `""` included (#735). */
export const isErrored = <T extends { readonly error?: unknown }>(
  r: T,
): r is T & { readonly error: string } => typeof r.error === "string";

/**
 * A zero score (not a mock-stopped run) with no grader detail: what a usage-limit run looks like, with
 * no `error` set (#735). A genuine zero has failing graders to show for it.
 */
export const isSilentZero = (r: {
  readonly score?: unknown;
  readonly graders?: unknown;
  readonly aborted?: unknown;
}): boolean =>
  r.score === 0 &&
  r.aborted !== true &&
  !(Array.isArray(r.graders) && r.graders.length > 0);

/**
 * Reasons a parsed result is too implausible to judge (#734, #735): wrong
 * `schemaVersion`, no cases, a case with no with-runs, or dropped non-object
 * entries. Empty when plausible. Shared by `readAggregateResult` and the CI
 * gate, `scripts/ts/check-plugin-eval.ts`; the CI gate adds `silentZeroReasons`.
 */
export const implausibleReasons = (doc: Rec): readonly string[] => {
  const version = doc["schemaVersion"];
  const cases = arr(doc["cases"]);
  const recs = cases.filter(isRec);
  const runsOf = (c: Rec, side: string): readonly unknown[] =>
    arr(isRec(c["arms"]) ? c["arms"][side] : undefined);
  const allRuns = recs.flatMap((c) =>
    (["with", "without"] as const).flatMap((s) => runsOf(c, s)),
  );
  const dropped =
    cases.length - recs.length + allRuns.filter((r) => !isRec(r)).length;
  return [
    ...(version === RESULT_SCHEMA_VERSION
      ? []
      : [
          `unsupported schemaVersion ${version === undefined ? "(missing)" : JSON.stringify(version)} (expected ${String(RESULT_SCHEMA_VERSION)})`,
        ]),
    ...(!Array.isArray(doc["cases"])
      ? ["missing cases array"]
      : cases.length === 0
        ? ["no cases"]
        : []),
    ...recs.flatMap((c) =>
      runsOf(c, "with").length === 0
        ? [`${optStr(c["name"]) ?? "(unnamed)"}: no with-arm runs`]
        : [],
    ),
    ...(dropped > 0
      ? [`${String(dropped)} malformed case or run entries`]
      : []),
  ];
};

/** Only the CI gate rejects these; the diagnosis reads them and judges per run. */
export const silentZeroReasons = (doc: Rec): readonly string[] => {
  const runs = arr(doc["cases"])
    .filter(isRec)
    .flatMap((c) =>
      ["with", "without"].flatMap((side) =>
        arr(isRec(c["arms"]) ? c["arms"][side] : undefined).filter(isRec),
      ),
    );
  return [
    ...(runs.some((r) => isSilentZero(r))
      ? ["a run scored 0 with no grader detail (usage limit?)"]
      : []),
    ...(runs.length > 0 && runs.every((r) => r["score"] === 0)
      ? ["every run scored 0"]
      : []),
  ];
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
  const bad = implausibleReasons(doc);
  if (bad.length > 0) return { ok: false, reason: bad.join("; ") };
  const result: AggregateResult = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    partial: doc["partial"] === true,
    partialReason: optStr(doc["partialReason"]),
    cases: arr(doc["cases"]).filter(isRec).map(readCaseResult),
  };
  return { ok: true, result };
};
