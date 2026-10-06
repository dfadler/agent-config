/**
 * Splits a suite into run groups: cases with identical grant sets share their
 * grants, each running under exactly its own grants, never a union
 * (docs/grants-format.md).
 */
import {
  checkGrantCaseNames,
  grantSet,
  type EvalSuite,
  type GrantsFile,
  type ParseIssue,
} from "../parser/index.ts";
import { hasGlobMeta } from "./command.ts";

export interface RunGroup {
  /** The shared grant set: sorted, de-duplicated `--allow-tools` entries. */
  readonly grants: readonly string[];
  /** Case names in the group, in suite order. */
  readonly cases: readonly string[];
}

/** One CLI invocation: a single case under its grant set. */
export interface Invocation {
  readonly grants: readonly string[];
  readonly caseName: string;
}

export type Plan =
  | { readonly ok: true; readonly groups: readonly RunGroup[] }
  | { readonly ok: false; readonly reason: string };

/** Parser issues from the suite and the grants file, as one message per line. */
export const issueLines = (
  issues: readonly ParseIssue[],
): readonly string[] =>
  issues.map(
    (i) =>
      `${i.loc.file}:${String(i.loc.line)}: ${i.message}`,
  );

/**
 * Group the suite's cases by grant set. `tag` keeps only cases carrying it.
 * Fails (rather than guessing) on parser issues, a stale grants entry, a case
 * name that would be read as a glob, or no case left to run.
 */
export const planGroups = (
  suite: EvalSuite,
  grants: GrantsFile,
  tag: string | undefined,
): Plan => {
  const names = suite.cases.map((c) => c.name.value);
  const checked = checkGrantCaseNames(grants, names);
  const problems = issueLines([...suite.issues, ...checked.issues]);
  if (problems.length > 0) {
    return { ok: false, reason: problems.join("\n") };
  }
  const selected = suite.cases.filter(
    (c) => tag === undefined || c.tags.value.includes(tag),
  );
  if (selected.length === 0) {
    return {
      ok: false,
      reason:
        tag === undefined
          ? `no cases found under ${suite.evalDir}`
          : `no cases tagged '${tag}' under ${suite.evalDir}`,
    };
  }
  const globby = selected.map((c) => c.name.value).filter(hasGlobMeta);
  if (globby.length > 0) {
    return {
      ok: false,
      reason: `case names with glob characters cannot be selected literally with --case: ${globby.join(", ")}`,
    };
  }
  const groups = selected.reduce<readonly RunGroup[]>((acc, c) => {
    const name = c.name.value;
    const set = grantSet(checked, name);
    const key = JSON.stringify(set);
    const existing = acc.find((g) => JSON.stringify(g.grants) === key);
    return existing === undefined
      ? [...acc, { grants: set, cases: [name] }]
      : acc.map((g) =>
          g === existing ? { ...g, cases: [...g.cases, name] } : g,
        );
  }, []);
  return { ok: true, groups };
};

/**
 * Flatten groups into one invocation per case, in suite order within each
 * group. Grouping only decides which cases share a grant set: `--case` takes
 * one glob, so each case is its own CLI run (#536, #538).
 */
export const planInvocations = (
  groups: readonly RunGroup[],
): readonly Invocation[] =>
  groups.flatMap((g) =>
    g.cases.map((caseName) => ({ grants: g.grants, caseName })),
  );

/** True when any group is granted Bash, which needs an OS sandbox backend. */
export const needsBash = (groups: readonly RunGroup[]): boolean =>
  groups.some((g) => g.grants.some((e) => /^Bash(\(|$)/.test(e)));
