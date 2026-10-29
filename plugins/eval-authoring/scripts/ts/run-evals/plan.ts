/**
 * Splits a suite into run groups: cases with identical grant sets share their
 * grants, each running under exactly its own grants, never a union
 * (docs/grants-format.md).
 */
import { join, relative } from "node:path";
import {
  checkGrantCaseNames,
  grantSet,
  type EvalCase,
  type EvalSuite,
  type GrantsFile,
  type ParseIssue,
} from "../parser/index.ts";
import { hasGlobMeta } from "./command.ts";
import type { Io } from "./io.ts";

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

/** A case name or a glob (`*` and `?` only) as an anchored regex. */
export const caseMatcher = (pattern: string): RegExp =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
  );

/**
 * Group the suite's cases by grant set. `tag` keeps only cases carrying it;
 * `only` (the wrapper's --case) keeps only cases whose name matches the glob;
 * `pick` (the wrapper's --changed) keeps only the cases listed.
 * Fails (rather than guessing) on parser issues, a stale grants entry, a case
 * name that would be read as a glob, or no case left to run.
 */
export const planGroups = (
  suite: EvalSuite,
  grants: GrantsFile,
  tag: string | undefined,
  only?: string,
  pick?: readonly string[],
): Plan => {
  const names = suite.cases.map((c) => c.name.value);
  const checked = checkGrantCaseNames(grants, names);
  const problems = issueLines([...suite.issues, ...checked.issues]);
  if (problems.length > 0) {
    return { ok: false, reason: problems.join("\n") };
  }
  const matcher = only === undefined ? undefined : caseMatcher(only);
  const selected = suite.cases.filter(
    (c) =>
      (tag === undefined || c.tags.value.includes(tag)) &&
      (matcher === undefined || matcher.test(c.name.value)) &&
      (pick === undefined || pick.includes(c.name.value)),
  );
  if (selected.length === 0) {
    return {
      ok: false,
      reason:
        tag === undefined && only === undefined && pick === undefined
          ? `no cases found under ${suite.evalDir}`
          : `no cases${tag === undefined ? "" : ` tagged '${tag}'`}${only === undefined ? "" : ` matching --case '${only}'`}${pick === undefined ? "" : ` among the --changed cases (${pick.join(", ")})`} under ${suite.evalDir}`,
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

/** The `--changed` ref when the clone records no origin HEAD. */
export const DEFAULT_CHANGED_REF = "origin/main";

export type ChangedSelection =
  | { readonly ok: true; readonly ref: string; readonly names: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const lines = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");

/** True when the case exercises skill or agent `name`: tagged with it, or a tool_used grader matches it. */
const exercises = (c: EvalCase, name: string): boolean =>
  c.tags.value.includes(name) ||
  c.graders.some(
    (g) => g.type === "tool_used" && (g.inputMatch.value ?? "").includes(name),
  );

/**
 * The cases `--changed` selects, in suite order, from plugin-relative `paths`:
 * a file under a case directory selects that case; `skills/<name>/` or
 * `agents/<name>.md` selects every case exercising `<name>`; grants.yaml, the
 * manifest or a hook selects every case. Other files select nothing.
 */
export const changedCases = (
  suite: EvalSuite,
  pluginRoot: string,
  paths: readonly string[],
): readonly string[] => {
  const targets = paths.flatMap((p) => {
    const m = /^(?:skills\/([^/]+)\/|agents\/([^/]+)\.md$)/.exec(p);
    return m === null ? [] : [m[1] ?? m[2] ?? ""];
  });
  const grantsFile = relative(pluginRoot, join(suite.evalDir, "grants.yaml"));
  // ponytail: a grants, manifest or hook change reruns every case; diff grants per entry if that proves too slow
  const everything = paths.some(
    (p) => p === grantsFile || /^(?:\.claude-plugin\/|hooks\/|hooks\.json$)/.test(p),
  );
  return suite.cases
    .filter(
      (c) =>
        everything ||
        paths.some((p) => p.startsWith(`${relative(pluginRoot, c.dir)}/`)) ||
        targets.some((t) => exercises(c, t)),
    )
    .map((c) => c.name.value);
};

/**
 * Resolve `--changed`: the files under `pluginRoot` touched since the merge
 * base with `ref` (committed, staged, unstaged and untracked), mapped to
 * cases. An empty `ref` means origin's HEAD, else DEFAULT_CHANGED_REF. Fails
 * when the ref does not resolve.
 */
export const selectChanged = async (
  io: Io,
  pluginRoot: string,
  suite: EvalSuite,
  ref: string,
): Promise<ChangedSelection> => {
  const git = (...args: readonly string[]) =>
    io.spawn("git", ["-C", pluginRoot, ...args]);
  const originHead =
    ref === ""
      ? await git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD")
      : undefined;
  const resolved =
    ref !== ""
      ? ref
      : originHead?.status === 0
        ? originHead.stdout.trim()
        : DEFAULT_CHANGED_REF;
  const base = await git("merge-base", resolved, "HEAD");
  if (base.status !== 0) {
    return {
      ok: false,
      reason: `--changed: no merge base of '${resolved}' and HEAD in ${pluginRoot}: ${(base.stderr || base.error || "").trim()}`,
    };
  }
  const diff = await git("diff", "--name-only", "--relative", base.stdout.trim(), "--", ".");
  const untracked = await git("ls-files", "--others", "--exclude-standard");
  const failed = [diff, untracked].find((r) => r.status !== 0);
  if (failed !== undefined) {
    return {
      ok: false,
      reason: `--changed: git failed in ${pluginRoot}: ${(failed.stderr || failed.error || "").trim()}`,
    };
  }
  const paths = [...new Set([...lines(diff.stdout), ...lines(untracked.stdout)])];
  return { ok: true, ref: resolved, names: changedCases(suite, pluginRoot, paths) };
};
