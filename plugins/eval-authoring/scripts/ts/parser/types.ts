/**
 * Exported types for the eval-authoring shared parser (#452) and its helpers
 * (#487). FROZEN once #486 merges: a missing field goes to the coordinator, not
 * into a rule PR (#449 ground rules).
 *
 * Design notes shared by every consumer:
 * - The parser never throws on a bad case. It records what it read (raw values,
 *   unvalidated) plus `issues` for anything it could not read, and the lint rules
 *   decide what is an error. Limits live only in `SchemaTable`.
 * - Every value is a `Field<T>`: the value, whether the author wrote it, and where.
 */

// ---------------------------------------------------------------------------
// Locations and fields
// ---------------------------------------------------------------------------

/** A position in a case file, so lint messages can point at the case. Used by every rule. */
export interface SourceLoc {
  /** Path of the file, as given to the reader (not resolved). */
  readonly file: string;
  /** 1-based line of the key (or of the value, for a list item). */
  readonly line: number;
  /** 1-based column, when the YAML parser reports it. */
  readonly column?: number;
}

/**
 * A parsed value with provenance. Used by every rule; EVAL019 needs `explicit`
 * for `tool_used.min`, EVAL005 for clearer messages.
 */
export interface Field<T> {
  /** The raw value, or the schema default when `explicit` is false. Never clamped or validated. */
  readonly value: T;
  /** True when the author wrote the key; false when `value` is the schema default. */
  readonly explicit: boolean;
  /**
   * Where the key was written. For a defaulted value, the case's primary file at
   * line 1, so a message about a missing key still has somewhere to point.
   */
  readonly loc: SourceLoc;
}

/** A problem reading a file or a value (bad YAML, wrong value type). Reported by the lint runner (#453). */
export interface ParseIssue {
  readonly kind:
    | "yaml-syntax"
    | "wrong-type"
    | "unreadable-file"
    | "malformed-frontmatter"
    | "unsupported-schema";
  readonly message: string;
  readonly loc: SourceLoc;
}

// ---------------------------------------------------------------------------
// Schema table (the single home of keys, defaults and limits)
// ---------------------------------------------------------------------------

/** Value shape of a schema key. */
export type FieldKind =
  | "string"
  | "number"
  | "boolean"
  | "string-list"
  | "env-map"
  | "object";

/** One key in the schema table: its name, shape, default and limits. Read by EVAL002 and EVAL003. */
export interface FieldSpec {
  readonly name: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** Default applied when the key is absent; undefined when there is none. */
  readonly default?: string | number | boolean | readonly string[];
  /** Inclusive lower bound for a number key. */
  readonly min?: number;
  /** Inclusive upper bound for a number key (the cap). */
  readonly max?: number;
  /** Allowed values for a closed set (arm, match). */
  readonly oneOf?: readonly string[];
}

/** The six grader types. */
export type GraderType =
  | "regex"
  | "tool_used"
  | "tool_order"
  | "file_exists"
  | "llm"
  | "baseline";

/** Keys a grader type accepts, beyond the common ones. */
export interface GraderTypeSpec {
  readonly type: GraderType;
  readonly keys: readonly FieldSpec[];
}

/**
 * The case schema as one table, stamped with the Claude Code version it was
 * written against. The lint rules read limits and key names from here and hold
 * none of their own. Used by EVAL002, EVAL003 and the runner's version report.
 */
export interface SchemaTable {
  /** Claude Code version the table was written against, for the drift report. */
  readonly claudeCodeVersion: string;
  /** Required `schema_version` value in `case.yaml` ("1.1"). */
  readonly caseYamlSchemaVersion: string;
  /** Default eval directory, relative to the plugin root ("evals"). */
  readonly defaultEvalDir: string;
  /** `prompt.md` frontmatter keys. An unknown key is an error. */
  readonly promptMdKeys: readonly FieldSpec[];
  /** `case.yaml` top-level keys. */
  readonly caseYamlTopLevelKeys: readonly FieldSpec[];
  /** `case.yaml` keys under `execution:`. */
  readonly caseYamlExecutionKeys: readonly FieldSpec[];
  /** `case.yaml` keys under `context:`. */
  readonly caseYamlContextKeys: readonly FieldSpec[];
  /** Keys every grader accepts (`name`, `type`, `weight`, `arm`). */
  readonly graderCommonKeys: readonly FieldSpec[];
  /** Per-type grader keys. */
  readonly graderTypes: readonly GraderTypeSpec[];
  /** Allowed `target` / `focus` keywords (`last_message`, `trace`, `files`, `mock_calls`). */
  readonly targetKeywords: readonly string[];
  /** Regular expression source an `env` key must match (`^EVAL_[A-Z0-9_]*$`). */
  readonly envKeyPattern: string;
  /** Tools that `allowed_tools` cannot grant (Bash, Write, Edit, WebFetch, WebSearch). Used by EVAL004, EVAL005. */
  readonly toolsNeedingGrant: readonly string[];
}

// ---------------------------------------------------------------------------
// Case model
// ---------------------------------------------------------------------------

/** Which files define a case. Used by the runner and by rules that apply to one layout. */
export type CaseLayout = "prompt-md" | "case-yaml" | "mixed";

/** Where a key was found. */
export type KeyOrigin =
  | "prompt.md"
  | "case.yaml"
  | "case.yaml:execution"
  | "case.yaml:context"
  | "grader";

/**
 * Every key found in a case file, classified by the parser against the schema
 * table. Used by EVAL002 (unknown key, run field at top level instead of under
 * `execution:`).
 */
export interface CaseKey {
  readonly name: string;
  readonly origin: KeyOrigin;
  /** `known`: in the table at this origin. `unknown`: in none. `misplaced`: valid, but under the wrong origin. */
  readonly status: "known" | "unknown" | "misplaced";
  /** For a misplaced key, the origin it belongs under. */
  readonly belongsUnder?: KeyOrigin;
  readonly loc: SourceLoc;
}

/**
 * One entry of `allowed_tools`, such as `Bash(npx *)`. Produced by
 * `parseAllowedTool`; used by EVAL004 and EVAL005.
 */
export interface AllowedTool {
  /** The entry as written. */
  readonly raw: string;
  /** The tool name: `Bash` out of `Bash(npx *)`. */
  readonly tool: string;
  /** The text inside the parentheses, or undefined for a bare name. */
  readonly specifier: string | undefined;
  readonly loc: SourceLoc;
}

/**
 * A `target` or `focus` value. Used by `graderCategory` and EVAL011, EVAL012.
 * `unknown` carries a value the schema table does not list, so a rule can report it.
 */
export type GraderTarget =
  | { readonly kind: "last_message" }
  | { readonly kind: "trace" }
  | { readonly kind: "files" }
  | { readonly kind: "mock_calls" }
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "unknown"; readonly raw: string };

/** Where a grader was defined. Used by the lint to point at it and by the runner for ordering. */
export interface GraderOrigin {
  readonly source: "case.yaml" | "graders-md";
  readonly file: string;
  /** Position in the final grader list (case.yaml graders first, then graders/*.md in name order). */
  readonly index: number;
  readonly loc: SourceLoc;
}

/** Keys shared by every grader. */
interface GraderBase {
  /** The grader's own name, when it has one (case.yaml graders carry `name`; graders/*.md fall back to the file name). */
  readonly name: Field<string | undefined>;
  /** Raw `weight`; default 1. Used by EVAL003 (non-positive weight). */
  readonly weight: Field<number>;
  /**
   * Raw `arm`. `undefined` when absent. Closed set per the schema table
   * (`with-only`, `both`); anything else is for EVAL003 to report.
   */
  readonly arm: Field<string | undefined>;
  readonly origin: GraderOrigin;
}

/** `regex` grader. Used by EVAL012. */
export interface RegexGrader extends GraderBase {
  readonly type: "regex";
  readonly pattern: Field<string>;
  readonly flags: Field<string | undefined>;
  readonly match: Field<string>;
  /** Default `last_message`. */
  readonly target: Field<GraderTarget>;
}

/** `tool_used` grader. `min` defaults to 1; EVAL019 reads `min.explicit`. Used by EVAL005, EVAL007, EVAL019. */
export interface ToolUsedGrader extends GraderBase {
  readonly type: "tool_used";
  readonly tool: Field<string>;
  readonly inputMatch: Field<string | undefined>;
  readonly min: Field<number>;
  readonly max: Field<number | undefined>;
}

/** `tool_order` grader. Used by EVAL009 (steps). */
export interface ToolOrderGrader extends GraderBase {
  readonly type: "tool_order";
  readonly before: Field<string>;
  readonly after: Field<string>;
}

/** `file_exists` grader. */
export interface FileExistsGrader extends GraderBase {
  readonly type: "file_exists";
  readonly path: Field<string>;
  /** Default true. */
  readonly exists: Field<boolean>;
}

/** `llm` (judge) grader. Used by EVAL006, EVAL009, EVAL011, EVAL016, EVAL017. */
export interface LlmGrader extends GraderBase {
  readonly type: "llm";
  readonly criteria: Field<string>;
  /** Default `last_message`. */
  readonly focus: Field<GraderTarget>;
}

/** `baseline` grader. Used by EVAL016, EVAL017. */
export interface BaselineGrader extends GraderBase {
  readonly type: "baseline";
  readonly baselineFile: Field<string>;
  readonly criteria: Field<string | undefined>;
}

/** A grader whose `type` is not one of the six. Kept so EVAL003 can report it. */
export interface UnknownGrader extends GraderBase {
  readonly type: "unknown";
  /** The `type` value as written (undefined when the key is missing). */
  readonly rawType: Field<string | undefined>;
}

/** Any grader, discriminated on `type`. */
export type Grader =
  | RegexGrader
  | ToolUsedGrader
  | ToolOrderGrader
  | FileExistsGrader
  | LlmGrader
  | BaselineGrader
  | UnknownGrader;

/** Whether a grader checks the outcome or the steps taken. Used by EVAL009. */
export type GraderCategory = "result" | "steps";

/** One `env` entry. Keys are unvalidated (EVAL003 checks them). */
export interface EnvEntry {
  readonly key: string;
  readonly value: string;
  readonly loc: SourceLoc;
}

/**
 * A case in either layout, merged per #452 (prompt.md frontmatter overrides
 * case.yaml fields, prompt.md body is the prompt, graders/*.md follow
 * case.yaml graders). Consumed by every lint rule, the wrapper and the
 * diagnosis script.
 */
export interface EvalCase {
  /** Path of the case directory, as given. */
  readonly dir: string;
  /** Final path segment of `dir`; the `name` default. */
  readonly dirName: string;
  readonly layout: CaseLayout;
  /** `prompt.md`, when present. */
  readonly promptFile: string | undefined;
  /** `case.yaml`, when present. */
  readonly caseYamlFile: string | undefined;
  /** `graders/*.md`, in name order. */
  readonly graderFiles: readonly string[];

  /** `case.yaml` `schema_version`; undefined when absent (EVAL002). Always undefined for a prompt.md-only case. */
  readonly schemaVersion: Field<string | undefined>;
  readonly name: Field<string>;
  readonly description: Field<string | undefined>;
  readonly tags: Field<readonly string[]>;
  /** `plugins:` entries, as written. Used by EVAL018. */
  readonly plugins: Field<readonly string[]>;
  readonly expectedOutcome: Field<string | undefined>;
  /** Default 3. */
  readonly runs: Field<number>;
  /** The prompt text (the `prompt.md` body, or `execution.prompt`). */
  readonly prompt: Field<string | undefined>;

  // Run settings (`execution:` in case.yaml; frontmatter in prompt.md).
  readonly model: Field<string | undefined>;
  /** Default 10. */
  readonly maxTurns: Field<number>;
  /** Default 300. */
  readonly timeoutSeconds: Field<number>;
  /** Default empty. */
  readonly allowedTools: Field<readonly AllowedTool[]>;
  readonly appendSystemPrompt: Field<string | undefined>;
  /** Default empty. */
  readonly env: Field<readonly EnvEntry[]>;

  // Context (`context:` in case.yaml).
  readonly scaffoldScript: Field<string | undefined>;
  readonly historyFile: Field<string | undefined>;
  readonly addDirs: Field<readonly string[]>;

  /** Merged graders, in order. Empty means EVAL001. */
  readonly graders: readonly Grader[];
  /** Every key seen, classified (EVAL002). */
  readonly keys: readonly CaseKey[];
  readonly issues: readonly ParseIssue[];
}

/** The eval directory and the cases found in it. */
export interface EvalSuite {
  readonly pluginRoot: string;
  /** Resolved eval directory (see `ResolvedEvalDir`). */
  readonly evalDir: string;
  /** Cases in directory-name order. */
  readonly cases: readonly EvalCase[];
  /** Suite-level mocks. Empty when the plugin declares none. */
  readonly mocks: MockCatalog;
  readonly issues: readonly ParseIssue[];
}

/** How the eval directory was chosen. Used by the runner and the lint report. */
export type EvalDirSource = "default" | "manifest" | "flag";

/** Result of resolving the eval directory. A bad path is reported, not thrown. */
export type ResolvedEvalDir =
  | {
      readonly ok: true;
      readonly dir: string;
      readonly source: EvalDirSource;
    }
  | {
      readonly ok: false;
      /** Why: not a relative path of plain directory names. */
      readonly reason: string;
      readonly source: EvalDirSource;
    };

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * What `isScored` needs beyond the grader. `mock_calls` graders are excluded
 * only when they check a plugin-declared mock, which the grader alone cannot say.
 * Used by EVAL008, EVAL009, EVAL010.
 */
export interface ScoringContext {
  /** Server names of mocks the plugin declares (`MockCatalog.declaredServers`). */
  readonly declaredMockServers: ReadonlySet<string>;
}

/** Why a grader is not scored in a two-arm run. */
export type ExclusionReason =
  | "skill-grader-implicit-with-only"
  | "arm-with-only"
  | "mock-calls-on-declared-mock";

/** One grader's scoring outcome. Used by EVAL008 and EVAL010. */
export interface GraderScoring {
  readonly grader: Grader;
  readonly scored: boolean;
  /** Set when `scored` is false. */
  readonly reason: ExclusionReason | undefined;
}

/** Scoring across a whole case. Used by EVAL008 (no Δ signal). */
export interface CaseScoring {
  readonly graders: readonly GraderScoring[];
  /** True when every grader would be excluded, so all score normally (docs rule). */
  readonly allExcludedFallback: boolean;
}

// ---------------------------------------------------------------------------
// Grants file (format agreed with #459)
// ---------------------------------------------------------------------------

/**
 * One case's entry in the grants file: the exact `--allow-tools` strings it
 * needs, such as `Bash(npx *)`. Used by EVAL004, EVAL005, the wrapper, the hook.
 */
export interface GrantEntry {
  /** The case name (the key in the file). */
  readonly caseName: string;
  readonly caseNameLoc: SourceLoc;
  /** Entries as `--allow-tools` takes them, parsed with `parseAllowedTool`. */
  readonly grants: readonly AllowedTool[];
}

/**
 * The grants file, beside `evals/` (`grants.yaml`), keyed by case name. A case
 * with no entry has no grants. Lookups go through `grantsForCase`.
 * Shape proposed for #459 to confirm: a YAML mapping of case name to a list of
 * strings. The reader adds `issues` for unknown keys, bad shapes and, once it
 * knows the case names, entries for cases that do not exist.
 */
export interface GrantsFile {
  /** Path of the file, or undefined when none exists (then every case has no grants). */
  readonly file: string | undefined;
  readonly entries: readonly GrantEntry[];
  readonly issues: readonly ParseIssue[];
}

// ---------------------------------------------------------------------------
// Result JSON (`aggregate-result.json`, schemaVersion 1, camelCase)
// ---------------------------------------------------------------------------

/**
 * One grader's result within a run. Every field is optional: the reader
 * tolerates omissions and ignores unknown fields. Used by the diagnosis script
 * (#462) and the #436 Δ gate.
 */
export interface GraderResult {
  readonly name?: string;
  readonly type?: string;
  readonly passed?: boolean;
  readonly score?: number;
  /** False when the grader was excluded from the score in a two-arm run. */
  readonly scored?: boolean;
}

/** One run of a case in one arm. */
export interface RunResult {
  readonly score?: number;
  /** Set when the run failed (a rate or usage limit is not marked `partial`). */
  readonly error?: string | null;
  /** A mock's `expect:` stopped the run; score 0, `error` stays null. */
  readonly aborted?: boolean;
  /** Judge graders skipped over the cost ceiling; the score is not comparable. */
  readonly skippedPaidGraders?: boolean;
  readonly graders?: readonly GraderResult[];
}

/** Aggregates for a case. `delta` is omitted when a case ran one arm or the arms are not comparable. */
export interface CaseAggregates {
  readonly delta?: number;
}

/** One case in the result document (`cases[]`). */
export interface CaseResult {
  readonly name: string;
  readonly aggregates: CaseAggregates;
  /** `arms.with[]`: runs with the plugin. */
  readonly withRuns: readonly RunResult[];
  /** `arms.without[]`: runs without it; empty for a one-arm or `--ablation none` run. */
  readonly withoutRuns: readonly RunResult[];
}

/** The parsed `aggregate-result.json`. */
export interface AggregateResult {
  readonly schemaVersion: number;
  readonly partial: boolean;
  readonly partialReason: string | undefined;
  readonly cases: readonly CaseResult[];
}

/** Outcome of reading `aggregate-result.json`. An unreadable document is reported, not thrown. Used by #462 and #436. */
export type ReadResultOutcome =
  | { readonly ok: true; readonly result: AggregateResult }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------------------
// Helpers delivered by #487 (Agent B): manifest, mocks, paths
// ---------------------------------------------------------------------------

/** A `dependencies` entry, normalised from its three forms. Used by EVAL018. */
export interface PluginDependency {
  /** Plugin name, without any `@marketplace` suffix. */
  readonly name: string;
  /** From the object form; undefined otherwise or when omitted. */
  readonly version: string | undefined;
  /** From `name@marketplace` or the object form; undefined otherwise. */
  readonly marketplace: string | undefined;
  /** Which of the three forms the entry was written in. */
  readonly form: "name" | "name@marketplace" | "object";
  readonly loc: SourceLoc;
}

/** Fields of `plugin.json` the rules need. Used by EVAL018 and the runner. */
export interface PluginManifest {
  readonly file: string;
  readonly name: string | undefined;
  /** Empty when the manifest declares none. */
  readonly dependencies: readonly PluginDependency[];
  /** The manifest's `experimental.evals` override, as written. */
  readonly experimentalEvals: string | undefined;
  readonly issues: readonly ParseIssue[];
}

/** Normalised mock `type`. `unknown` carries any other value. */
export type MockType = "agent" | "script" | "static" | "unknown";

/** One mock file, `evals/mocks/<server>/<tool>.md`. Used by EVAL013. */
export interface Mock {
  readonly server: string;
  readonly tool: string;
  readonly file: string;
  /** Raw `type` frontmatter; undefined when absent. */
  readonly type: string | undefined;
  readonly typeKind: MockType;
  /** Raw `expect` frontmatter; undefined when absent. Validation is EVAL013's. */
  readonly expect: string | undefined;
  /** True when a sibling `<tool>.replay` exists. */
  readonly hasReplay: boolean;
  /** `case` when a case's own `mocks/` file won the override, else `suite`. */
  readonly scope: "suite" | "case";
  readonly loc: SourceLoc;
}

/** Mocks visible to a suite or case after the case's own `mocks/` overrides the suite's, file by file. */
export interface MockCatalog {
  readonly mocks: readonly Mock[];
  /** Servers named in the plugin's MCP config; empty when it has none. */
  readonly mcpServers: readonly string[];
  /** Servers that have at least one mock (feeds `ScoringContext.declaredMockServers`). */
  readonly declaredServers: ReadonlySet<string>;
  readonly issues: readonly ParseIssue[];
}

/** Outcome of resolving a path against a case directory and checking it stays in the plugin. Used by EVAL014, EVAL018. */
export interface ResolvedPath {
  /** Absolute resolved path. */
  readonly resolved: string;
  /**
   * True when `resolved` lies inside the plugin root. Symlinks are not assumed
   * to pass: whether one satisfies the CLI's containment check is unverified (#449).
   */
  readonly insidePluginRoot: boolean;
  /** Whether the path exists on disk. */
  readonly exists: boolean;
}
