/**
 * Types for the eval-authoring lint framework (#453). A rule is one file in
 * `rules/` that exports a `Rule`; the runner discovers it, so adding a rule
 * never edits a shared file. See `docs/lint-rules.md` for the author guide.
 */
import type {
  EvalCase,
  EvalSuite,
  GrantsFile,
  PluginManifest,
  SchemaTable,
  SourceLoc,
} from "../parser/index.ts";

/** `error` fails the run (exit 1); `warn` and `info` are reported only. */
export type Severity = "error" | "warn" | "info";

/**
 * What a rule found. The runner adds the rule ID, severity and source, so a
 * rule only says what is wrong and how to fix it. Both texts are required:
 * the lint's messages are how a plugin teaches (it cannot ship path-scoped rules).
 */
export interface Problem {
  /** What is wrong, naming the offending value. One sentence. */
  readonly message: string;
  /** What to change. Imperative, specific. */
  readonly fix: string;
  /** Where to point: a `loc` from the parser (`Field.loc`, `Grader.origin.loc`, `CaseKey.loc`...). */
  readonly loc: SourceLoc;
  /** Overrides the rule's severity for this problem (EVAL007 mixes error and warn). */
  readonly severity?: Severity;
  /** Overrides the rule's `source` for this problem (a rule whose basis is "from #411"). */
  readonly source?: string;
}

/** Everything a rule may read. Built once per run by the runner. */
export interface LintContext {
  readonly pluginRoot: string;
  /** The schema table. Rules read key names and limits from here, never their own constants. */
  readonly schema: SchemaTable;
  readonly suite: EvalSuite;
  /** The grants file, already checked with `checkGrantCaseNames`. Empty when absent. */
  readonly grants: GrantsFile;
  readonly manifest: PluginManifest;
}

/** A lint rule: one file under `rules/`, exported as `rule`. */
export interface Rule {
  /** `EVAL` plus three digits. Must match the file name prefix (`eval004-...ts` is `EVAL004`). */
  readonly id: string;
  /** Default severity of this rule's problems. */
  readonly severity: Severity;
  /** One line: what the rule checks. Shown by `--list-rules`. */
  readonly title: string;
  /** Why the rule exists: a docs section, or "from #411" where the docs do not say. */
  readonly source: string;
  /** Called once per case. */
  readonly checkCase?: (
    evalCase: EvalCase,
    context: LintContext,
  ) => readonly Problem[];
  /** Called once per run, for repo or suite level checks. */
  readonly checkSuite?: (context: LintContext) => readonly Problem[];
}

/** A problem with its rule's identity attached; what the runner reports. */
export interface Finding {
  readonly ruleId: string;
  readonly severity: Severity;
  readonly message: string;
  readonly fix: string;
  readonly source: string;
  readonly loc: SourceLoc;
  /** Directory name of the case, or undefined for a suite-level finding. */
  readonly caseDirName: string | undefined;
}
