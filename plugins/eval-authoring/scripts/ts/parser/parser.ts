/**
 * Function stubs for the shared parser (#452). Signatures are FROZEN with the
 * types (see types.ts); #452 replaces each body. No behavior lives here yet.
 */
import { notImplemented } from "./not-implemented.ts";
import type {
  AllowedTool,
  CaseScoring,
  EvalCase,
  EvalSuite,
  Grader,
  GraderCategory,
  GrantsFile,
  ReadResultOutcome,
  ResolvedEvalDir,
  SchemaTable,
  ScoringContext,
  SourceLoc,
} from "./types.ts";

/** Options for locating the eval directory. */
export interface EvalDirOptions {
  /** The `--eval-dir` flag value, when given; wins over the manifest. */
  readonly flag?: string;
}

/** The schema table. The only place limits and key names live. Used by EVAL002, EVAL003. */
export const getSchema: () => SchemaTable = () => notImplemented("getSchema");

/**
 * Resolve the eval directory: `--eval-dir`, else the manifest's
 * `experimental.evals`, else `evals/`. Only a relative path of plain directory
 * names is accepted. Used by the lint runner, wrapper and hook.
 */
export const resolveEvalDir: (
  pluginRoot: string,
  options?: EvalDirOptions,
) => ResolvedEvalDir = () => notImplemented("resolveEvalDir");

/**
 * Read one case directory in either layout (or both). Never throws on a bad
 * case; problems land in `EvalCase.issues`. Used by every rule.
 */
export const readCase: (caseDir: string) => EvalCase = () =>
  notImplemented("readCase");

/** Read every case under the resolved eval directory, plus suite mocks. Used by the lint runner. */
export const readSuite: (
  pluginRoot: string,
  options?: EvalDirOptions,
) => EvalSuite = () => notImplemented("readSuite");

/**
 * Read the grants file at `file`. A missing file gives an empty `GrantsFile`
 * with `file: undefined` (every case then has no grants). Used by EVAL004,
 * EVAL005, the wrapper and the hook.
 */
export const readGrantsFile: (file: string) => GrantsFile = () =>
  notImplemented("readGrantsFile");

/** The grants for one case; empty when it has no entry. Used by EVAL004, EVAL005. */
export const grantsForCase: (
  grants: GrantsFile,
  caseName: string,
) => readonly AllowedTool[] = () => notImplemented("grantsForCase");

/**
 * Parse `aggregate-result.json` text (`schemaVersion: 1`, camelCase). Ignores
 * unknown fields and tolerates an omitted `delta`. Used by the diagnosis
 * script (#462) and the #436 Δ gate.
 */
export const readAggregateResult: (text: string) => ReadResultOutcome = () =>
  notImplemented("readAggregateResult");

/**
 * Parse an `allowed_tools` or grants entry: `Bash` out of `Bash(npx *)`.
 * Used by EVAL004, EVAL005.
 */
export const parseAllowedTool: (raw: string, loc: SourceLoc) => AllowedTool =
  () => notImplemented("parseAllowedTool");

/**
 * Whether a grader counts toward the score in a run. In a two-arm run:
 * `tool_used: Skill` is implicitly `with-only`, `arm: with-only` is unscored,
 * and a `mock_calls` grader on a plugin-declared mock is unscored unless
 * `arm: both`. With `twoArm` false, everything is scored. The "all excluded,
 * so all score" fallback is in `scoreCase`, not here. Used by EVAL008,
 * EVAL009, EVAL010.
 */
export const isScored: (
  grader: Grader,
  twoArm: boolean,
  context?: ScoringContext,
) => boolean = () => notImplemented("isScored");

/** `isScored` for every grader of a case, with reasons and the all-excluded fallback. Used by EVAL008, EVAL010. */
export const scoreCase: (
  evalCase: EvalCase,
  twoArm: boolean,
  context?: ScoringContext,
) => CaseScoring = () => notImplemented("scoreCase");

/**
 * Result versus steps taken, from `type` plus `target` or `focus`: `tool_used`
 * and `tool_order` and trace or mock-call targets check steps; the rest check
 * the result. Undefined for an unknown grader type. Used by EVAL009.
 */
export const graderCategory: (grader: Grader) => GraderCategory | undefined =
  () => notImplemented("graderCategory");
