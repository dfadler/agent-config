/**
 * Splits a suite into run groups: cases with identical grant sets share their
 * grants, each running under exactly its own grants, never a union
 * (docs/grants-format.md).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
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
  groups.some((g) => hasBash(g.grants));

/** The `--changed` ref when the clone records no origin HEAD. */
export const DEFAULT_CHANGED_REF = "origin/main";

/** Cases carrying this tag check routing (does the skill fire?); a frontmatter change reruns them all. */
export const TRIGGER_TAG = "trigger";

export type ChangedSelection =
  | {
      readonly ok: true;
      readonly ref: string;
      /** Every changed plugin-relative path, mapped or not. */
      readonly paths: readonly string[];
      readonly names: readonly string[];
      /** Changed paths that select no case. */
      readonly unmapped: readonly string[];
    }
  | { readonly ok: false; readonly reason: string };

const nulSplit = (text: string): readonly string[] =>
  text.split("\0").filter((l) => l !== "");

const hasBash = (grants: readonly string[]): boolean =>
  grants.some((e) => /^Bash(\(|$)/.test(e));

/** True when a tool_used grader's input_match would accept a Skill or Agent call naming `name`. */
const matchesCall = (pattern: string | undefined, name: string): boolean => {
  if (pattern === undefined) return false;
  try {
    const re = new RegExp(pattern);
    return [{ skill: name }, { subagent_type: name }].some((p) => re.test(JSON.stringify(p)));
  } catch {
    return false;
  }
};

/** True when the case exercises skill or agent `name`: tagged with it, or a tool_used grader matches a call to it. */
const exercises = (c: EvalCase, name: string): boolean =>
  c.tags.value.includes(name) ||
  c.graders.some((g) => g.type === "tool_used" && matchesCall(g.inputMatch.value, name));

/** The text of every file under `hooks/` and `hooks.json`, joined; "" when there are none. */
const hooksText = (pluginRoot: string): string => {
  const walk = (p: string): readonly string[] => {
    if (!existsSync(p)) return [];
    if (statSync(p).isDirectory()) return readdirSync(p).flatMap((e) => walk(join(p, e)));
    return [readFileSync(p, "utf8")];
  };
  return [...walk(join(pluginRoot, "hooks")), ...walk(join(pluginRoot, "hooks.json"))].join("\n");
};

/** The YAML frontmatter of a Markdown file ("" when there is none). */
const frontmatter = (text: string | undefined): string =>
  /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text ?? "")?.[0] ?? "";

export interface ChangedContext {
  readonly grants: GrantsFile;
  /** Skills (`skills/<name>/`) whose frontmatter changed: their routing is in question. */
  readonly routingChanged: readonly string[];
}

/**
 * The cases `--changed` selects, in suite order, from plugin-relative `paths`,
 * plus the paths that selected nothing:
 * - a file under a case directory selects that case;
 * - `skills/<name>/` or `agents/<name>.md` selects every case exercising
 *   `<name>`; a skill whose frontmatter (description) changed also selects
 *   every `trigger`-tagged case, since routing itself changed;
 * - `scripts/**` selects every case granted Bash, or every case when a hook
 *   references the changed script;
 * - grants.yaml, the manifest or a hook selects every case;
 * - docs, README and anything else select nothing.
 */
export const changedCases = (
  suite: EvalSuite,
  pluginRoot: string,
  paths: readonly string[],
  ctx: ChangedContext,
): { readonly names: readonly string[]; readonly unmapped: readonly string[] } => {
  const all = suite.cases.map((c) => c.name.value);
  const grantsFile = relative(pluginRoot, join(suite.evalDir, "grants.yaml"));
  const hooks = paths.some((p) => p.startsWith("scripts/")) ? hooksText(pluginRoot) : "";
  // ponytail: a hook "references" a script when its path appears verbatim; transitive imports are not followed
  const mapPath = (p: string): readonly string[] => {
    if (p === grantsFile || /^(?:\.claude-plugin\/|hooks\/|hooks\.json$)/.test(p)) return all;
    if (p.startsWith("scripts/")) {
      return hooks.includes(p)
        ? all
        : all.filter((n) => hasBash(grantSet(ctx.grants, n)));
    }
    const m = /^(?:skills\/([^/]+)\/|agents\/([^/]+)\.md$)/.exec(p);
    const target = m?.[1] ?? m?.[2];
    const routing = m?.[1] !== undefined && ctx.routingChanged.includes(m[1]);
    return suite.cases
      .filter(
        (c) =>
          p.startsWith(`${relative(pluginRoot, c.dir)}/`) ||
          (target !== undefined && exercises(c, target)) ||
          (routing && c.tags.value.includes(TRIGGER_TAG)),
      )
      .map((c) => c.name.value);
  };
  const mapped = paths.map((p) => [p, mapPath(p)] as const);
  const picked = new Set(mapped.flatMap(([, names]) => names));
  return {
    names: all.filter((n) => picked.has(n)),
    unmapped: mapped.filter(([, names]) => names.length === 0).map(([p]) => p),
  };
};

/**
 * Resolve `--changed`: the files under `pluginRoot` touched since the merge
 * base with `ref` (committed, staged, unstaged and untracked), mapped to
 * cases. An empty `ref` means origin's HEAD, else DEFAULT_CHANGED_REF. Fails
 * when the ref does not resolve or the eval dir lies outside the plugin.
 */
export const selectChanged = async (
  io: Io,
  pluginRoot: string,
  suite: EvalSuite,
  grants: GrantsFile,
  ref: string,
): Promise<ChangedSelection> => {
  const evalRel = relative(io.realpath(pluginRoot), io.realpath(suite.evalDir));
  if (evalRel.startsWith("..") || isAbsolute(evalRel)) {
    return {
      ok: false,
      reason: `--changed: eval dir ${suite.evalDir} resolves outside the plugin ${pluginRoot}; its changes would never be seen`,
    };
  }
  const git = (...args: readonly string[]) =>
    io.spawn("git", ["-C", pluginRoot, ...args]);
  const originHead =
    ref === ""
      ? await git("symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD")
      : undefined;
  const resolved =
    ref !== ""
      ? ref
      : originHead?.status === 0 && originHead.stdout.trim() !== ""
        ? originHead.stdout.trim()
        : DEFAULT_CHANGED_REF;
  const base = await git("merge-base", resolved, "HEAD");
  if (base.status !== 0) {
    return {
      ok: false,
      reason: `--changed: no merge base of '${resolved}' and HEAD in ${pluginRoot}: ${(base.stderr || base.error || "").trim()}`,
    };
  }
  const baseSha = base.stdout.trim();
  const diff = await git("diff", "--name-only", "-z", "--relative", baseSha, "--", ".");
  const untracked = await git("ls-files", "--others", "--exclude-standard", "-z");
  const failed = [diff, untracked].find((r) => r.status !== 0);
  if (failed !== undefined) {
    return {
      ok: false,
      reason: `--changed: git failed in ${pluginRoot}: ${(failed.stderr || failed.error || "").trim()}`,
    };
  }
  const paths = [...new Set([...nulSplit(diff.stdout), ...nulSplit(untracked.stdout)])];
  const skills = paths.flatMap((p) => {
    const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(p);
    return m?.[1] === undefined ? [] : [{ name: m[1], path: p }];
  });
  const routingChanged = (
    await Promise.all(
      skills.map(async ({ name, path }) => {
        const before = await git("show", `${baseSha}:./${path}`);
        const file = join(pluginRoot, path);
        const after = existsSync(file) ? readFileSync(file, "utf8") : undefined;
        const changed =
          before.status !== 0 || after === undefined || frontmatter(before.stdout) !== frontmatter(after);
        return changed ? [name] : [];
      }),
    )
  ).flat();
  const { names, unmapped } = changedCases(suite, pluginRoot, paths, { grants, routingChanged });
  return { ok: true, ref: resolved, paths, names, unmapped };
};
