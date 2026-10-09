// Remove local git worktrees whose pull request has already been MERGED, and
// leave everything else untouched. Companion to Claude Code's worktrees under
// .claude/worktrees/, whether created by EnterWorktree/--worktree on a
// `worktree-*` branch or by the desktop app on an auto-generated `claude/*`
// branch. Claude Code's own periodic stale-worktree sweep only looks at local
// git state (age, lock, clean/pushed); it cannot know a PR merged, so a merged
// worktree from an ordinary interactive session lingers forever unless
// something checks GitHub. This script is that check.
//
// Scope & safety - a worktree is only ever removed when ALL of these hold:
//   * its path is under .claude/worktrees/ AND its branch matches `worktree-*`
//     or `claude/*` (hand-made worktrees and the main checkout are never touched)
//   * it is NOT locked (Claude Code locks a worktree while a session uses it)
//   * it is NOT the worktree this script is being run from
//   * its working tree is clean AND has no commits that aren't pushed to its
//     upstream
//   * a MERGED pull request exists for its branch at the SAME commit the
//     worktree is currently at, not just a branch-name match
// Anything that fails a check is reported and LEFT in place. Never uses --force.
//
// Merged detection asks GitHub via `gh pr list --state merged` (matched by head
// branch AND head commit) rather than `git branch --merged`, which is wrong for
// squash/rebase merges. `gh` keeps returning an OLD PR's record after its branch
// name is reused, so the worktree's own HEAD must equal the PR's headRefOid.
//
// Remote branches are intentionally NOT deleted here; this is local-only cleanup.
//
// A branch never individually pushed (no @{u}) falls back to checking whether
// its HEAD is already an ancestor of the project's main branch.
//
// A directory under .claude/worktrees/ that git's `worktree list` doesn't know
// about (wreckage from a creation that never completed) is swept separately,
// only when older than 10 minutes and holding nothing but empty directories. A
// top-level symlink there is never swept.
//
// A project may declare, in its own .claude/settings.json, tracked files whose
// diff is safe to revert before the clean check IF AND ONLY IF the entire diff
// is exactly an appended marker-delimited block:
//   { "worktree": { "autoPruneCruftMarkers": [
//     { "path": "CLAUDE.md", "beginMarker": "<!-- BEGIN:some-marker -->",
//       "endMarker": "<!-- END:some-marker -->" }
//   ] } }
// endMarker is required: an entry missing it is silently ignored, because
// without a defined end there is no telling the block from real content after
// it, and the revert discards the whole file. The revert fires only once every
// OTHER condition for removal already holds.
//
// Usage:
//   prune-merged-worktrees.ts              # dry run: report only, remove nothing
//   prune-merged-worktrees.ts --yes        # actually remove the merged worktrees
//   prune-merged-worktrees.ts --hook       # quiet unless something is removable
//                                          # (read-only nudge); never removes anything
//   prune-merged-worktrees.ts --auto       # quiet auto-remove for the SessionStart
//                                          # hook: removes the merged set, prints a
//                                          # one-line summary, never fails the session
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { asArray, asObject } from "./json.ts";
import { makeRun, type Env, type Run } from "./proc.ts";

export interface Ctx {
  readonly cwd: string;
  readonly run: Run;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Epoch seconds. */
  readonly now: () => number;
}

/** Directories younger than this are never swept; a concurrent session may be mid-creation. */
export const ORPHAN_GRACE_SECONDS = 600;

interface Marker {
  readonly path: string;
  readonly begin: string;
  readonly end: string;
}

/** The leading `//` comment block of this file, as --help output. */
const helpText = (): string => {
  const lines = readFileSync(import.meta.filename, "utf8").split("\n");
  const header: string[] = [];
  for (const l of lines) {
    if (l.startsWith("//")) header.push(l.replace(/^\/\/ ?/, ""));
    else if (header.length > 0) break;
  }
  return header.join("\n");
};

/**
 * Locate a marker-delimited block: the line of the FIRST begin marker through
 * the line of the LAST end marker at or after it (1-indexed). Pure text.
 */
export const markerBlockBounds = (
  text: string,
  begin: string,
  end: string,
): { readonly begin: number; readonly end: number } | undefined => {
  const lines = text.split("\n");
  const b = lines.findIndex((l) => l.includes(begin));
  if (b < 0) return undefined;
  const e = lines.findLastIndex((l) => l.includes(end));
  return e >= b ? { begin: b + 1, end: e + 1 } : undefined;
};

const readMarkers = (repoRoot: string): readonly Marker[] => {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(`${repoRoot}/.claude/settings.json`, "utf8"),
    );
    const list = asArray(
      asObject(asObject(parsed)?.["worktree"])?.["autoPruneCruftMarkers"],
    );
    if (list === undefined) return [];
    const out: Marker[] = [];
    for (const m of list) {
      const r = asObject(m);
      const path = r?.["path"];
      const begin = r?.["beginMarker"];
      const end = r?.["endMarker"];
      if (
        typeof path === "string" &&
        typeof begin === "string" &&
        typeof end === "string" &&
        path !== "" &&
        begin !== "" &&
        end !== ""
      )
        out.push({ path, begin, end });
    }
    return out;
  } catch {
    // Absent or malformed config: the mechanism is inert.
    return [];
  }
};

interface Record_ {
  path: string;
  branch: string;
  locked: boolean;
}

const parseWorktrees = (porcelain: string): Record_[] => {
  const recs: Record_[] = [];
  let cur: Record_ = { path: "", branch: "", locked: false };
  const flush = (): void => {
    if (cur.path !== "") recs.push(cur);
    cur = { path: "", branch: "", locked: false };
  };
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) cur.path = line.slice(9);
    else if (line.startsWith("branch refs/heads/"))
      cur.branch = line.slice(18);
    else if (line.startsWith("locked")) cur.locked = true;
    else if (line === "") flush();
  }
  flush();
  return recs;
};

const hasNonDir = (dir: string): boolean =>
  readdirSync(dir, { withFileTypes: true }).some((e) =>
    e.isDirectory() ? hasNonDir(`${dir}/${e.name}`) : true,
  );

/** Run the tool; returns the process exit code. */
export const main = (argv: readonly string[], ctx: Ctx): number => {
  let apply = false;
  let hook = false;
  let auto = false;
  for (const arg of argv) {
    if (arg === "-y" || arg === "--yes") apply = true;
    else if (arg === "--hook") hook = true;
    else if (arg === "--auto") {
      auto = true;
      hook = true;
    } else if (arg === "-h" || arg === "--help") {
      ctx.out(helpText());
      return 0;
    } else {
      ctx.err(`Unknown option: ${arg}`);
      return 1;
    }
  }
  // --auto removes; --hook alone is a read-only nudge even with --yes.
  if (auto) apply = true;
  else if (hook) apply = false;

  const { cwd, run } = ctx;
  const git = (args: readonly string[], at = cwd) => run("git", args, at);

  if (git(["rev-parse", "--is-inside-work-tree"]).status !== 0) {
    if (hook) return 0;
    ctx.err("Not inside a git repository.");
    return 1;
  }
  const self = git(["rev-parse", "--show-toplevel"]).stdout.trim();
  // --git-common-dir is the MAIN checkout's .git even from a linked worktree.
  const common = git(["rev-parse", "--git-common-dir"]).stdout.trim();
  const repoRoot = realpathSync(resolve(cwd, common, ".."));
  const wtPrefix = `${repoRoot}/.claude/worktrees/`;

  if (
    run("gh", ["--version"], cwd).status !== 0 ||
    run("gh", ["auth", "status"], cwd).status !== 0
  ) {
    if (hook) return 0;
    ctx.err(
      "This needs the GitHub CLI, authenticated: install 'gh' and run 'gh auth login'.",
    );
    return 1;
  }

  // One API call. Fail CLOSED if it errors or returns junk: an empty result
  // would be indistinguishable from "nothing merged".
  const fetchFailed = (): number => {
    if (hook) return 0;
    ctx.err(
      "Couldn't fetch merged PRs from GitHub (network or API error). Aborting without changes.",
    );
    return 1;
  };
  const listed = run(
    "gh",
    [
      "pr",
      "list",
      "--state",
      "merged",
      "--limit",
      "500",
      "--json",
      "headRefName,headRefOid",
    ],
    cwd,
  );
  if (listed.status !== 0) return fetchFailed();
  const merged = new Set<string>();
  try {
    const rows = asArray(JSON.parse(listed.stdout));
    if (rows === undefined) return fetchFailed();
    for (const row of rows) {
      const r = asObject(row);
      merged.add(`${String(r?.["headRefName"])}\t${String(r?.["headRefOid"])}`);
    }
  } catch {
    return fetchFailed();
  }
  const isMerged = (branch: string, oid: string): boolean =>
    merged.has(`${branch}\t${oid}`);

  // Deliberately NO `git fetch --prune`: it would delete the remote-tracking
  // ref that keeps @{u} resolvable for a merged-and-auto-deleted branch, and
  // every such worktree would then be mis-kept as unpushed.
  let mainRef = "";
  if (git(["rev-parse", "--verify", "--quiet", "main"]).status === 0)
    mainRef = "main";
  else if (git(["rev-parse", "--verify", "--quiet", "origin/main"]).status === 0)
    mainRef = "origin/main";

  const pushedOrOnMain = (path: string): boolean => {
    if (git(["rev-parse", "--verify", "--quiet", "@{u}"], path).status === 0) {
      const r = git(["rev-list", "--count", "@{u}..HEAD"], path);
      return r.status === 0 && r.stdout.trim() === "0";
    }
    if (mainRef === "") return false;
    return git(["merge-base", "--is-ancestor", "HEAD", mainRef], path).status === 0;
  };

  const markers = readMarkers(repoRoot);

  /** True when the file has no diff from HEAD, or the diff is exactly an appended marker block. */
  const onlyMarkerBlock = (path: string, m: Marker): boolean => {
    if (git(["diff", "--quiet", "HEAD", "--", m.path], path).status === 0)
      return true;
    let text: string;
    try {
      text = readFileSync(`${path}/${m.path}`, "utf8");
    } catch {
      // Deleted tracked file is a real diff.
      return false;
    }
    const b = markerBlockBounds(text, m.begin, m.end);
    if (b === undefined || b.begin < 2) return false;
    const lines = text.split("\n");
    // Nothing real may follow the end marker, and the single separator line
    // before the begin marker must be blank.
    if (!lines.slice(b.end).every((l) => l === "")) return false;
    if (lines[b.begin - 2] !== "") return false;
    const show = git(["show", `HEAD:${m.path}`], path);
    if (show.status !== 0) return false;
    const headLineCount = show.stdout.split("\n").length - 1;
    if (headLineCount !== b.begin - 2) return false;
    const strip = (s: string): string => s.replace(/\n+$/, "");
    return strip(lines.slice(0, b.begin - 2).join("\n")) === strip(show.stdout);
  };

  const revertMarkers = (path: string): void => {
    for (const m of markers) {
      try {
        statSync(`${path}/${m.path}`);
      } catch {
        continue;
      }
      if (git(["diff", "--quiet", "HEAD", "--", m.path], path).status === 0)
        continue;
      // Explicit HEAD: a bare checkout restores from the index, which for a
      // staged block is already the modified content.
      git(["checkout", "HEAD", "--", m.path], path);
    }
  };

  // Rules are apply-blind: dry run and --yes make the same decision.
  // Evaluated in order; the first failure is the KEEP reason.
  type Rule = (path: string, branch: string, locked: boolean) => string | undefined;
  const rules: readonly Rule[] = [
    (p) => (p === self ? "current session" : undefined),
    (_p, _b, locked) =>
      locked ? "locked (another session is using it)" : undefined,
    (p, b) =>
      isMerged(b, git(["rev-parse", "HEAD"], p).stdout.trim())
        ? undefined
        : `no merged PR for ${b}`,
    (p) => {
      const excludes = markers.map((m) => `:!${m.path}`);
      const dirty =
        git(["status", "--porcelain", "--", ".", ...excludes], p).stdout.trim() !==
        "";
      return !dirty && markers.every((m) => onlyMarkerBlock(p, m))
        ? undefined
        : "uncommitted changes";
    },
    (p) => (pushedOrOnMain(p) ? undefined : "unpushed commits (or no upstream)"),
  ];

  const removable: { path: string; branch: string }[] = [];
  const report: string[] = [];
  const allPaths = new Set<string>();
  const listing = git(["worktree", "list", "--porcelain"]).stdout;
  for (const rec of parseWorktrees(listing)) {
    allPaths.add(rec.path);
    // Only Claude-created worktrees are in scope.
    if (!rec.path.startsWith(wtPrefix)) continue;
    if (!rec.branch.startsWith("worktree-") && !rec.branch.startsWith("claude/"))
      continue;
    const name = rec.path.slice(repoRoot.length + 1);
    // First failing rule wins; later (costlier) rules are not evaluated.
    let keep: string | undefined;
    for (const rule of rules) {
      keep = rule(rec.path, rec.branch, rec.locked);
      if (keep !== undefined) break;
    }
    if (keep !== undefined) {
      report.push(`keep    ${name} — ${keep}`);
      continue;
    }
    // Every REMOVE condition holds, so reverting marker files can only
    // complete a removal that was already going to happen.
    if (apply) revertMarkers(rec.path);
    removable.push({ path: rec.path, branch: rec.branch });
    report.push(`REMOVE  ${name} — ${rec.branch} merged`);
  }

  const removedBranches: string[] = [];
  const removeRemovable = (verbose: boolean): void => {
    for (const { path, branch } of removable) {
      if (verbose) ctx.out(`==> Removing ${path} (${branch})`);
      if (git(["worktree", "remove", path]).status === 0) {
        git(["branch", "-D", branch]);
        removedBranches.push(branch);
      } else if (verbose) {
        ctx.err(`    Could not remove ${path} — left in place.`);
      }
    }
    git(["worktree", "prune"]);
  };

  const removedOrphans: string[] = [];
  const sweepOrphans = (verbose: boolean): void => {
    let names: string[];
    try {
      names = readdirSync(wtPrefix);
    } catch {
      return;
    }
    const now = ctx.now();
    for (const name of names) {
      const d = `${wtPrefix}${name}`;
      try {
        // Never sweep a top-level symlink, or anything git knows about.
        if (lstatSync(d).isSymbolicLink() || !statSync(d).isDirectory()) continue;
        if (allPaths.has(d)) continue;
        if (now - Math.floor(statSync(d).mtimeMs / 1000) < ORPHAN_GRACE_SECONDS)
          continue;
        // A symlink (even to a dir) or file anywhere means real content.
        if (hasNonDir(d)) continue;
        rmSync(d, { recursive: true, force: true });
      } catch {
        continue;
      }
      removedOrphans.push(d.slice(repoRoot.length + 1));
      if (verbose) ctx.out(`==> Removing ${d} (empty, not a registered worktree)`);
    }
  };

  if (auto) {
    if (removable.length > 0) {
      removeRemovable(false);
      if (removedBranches.length > 0) {
        ctx.out(`🧹 Removed ${String(removedBranches.length)} merged worktree(s):`);
        for (const b of removedBranches) ctx.out(`   • ${b}`);
      }
    } else {
      git(["worktree", "prune"]);
    }
    sweepOrphans(false);
    if (removedOrphans.length > 0) {
      ctx.out(
        `🧹 Removed ${String(removedOrphans.length)} orphaned worktree director(ies):`,
      );
      for (const d of removedOrphans) ctx.out(`   • ${d}`);
    }
    return 0;
  }

  if (hook) {
    if (removable.length > 0) {
      ctx.out(
        `🧹 ${String(removable.length)} merged worktree(s) can be cleaned up:`,
      );
      for (const r of removable) ctx.out(`   • ${r.branch}`);
      ctx.out(`   Remove them with: node ${import.meta.filename} --yes`);
    }
    return 0;
  }

  if (apply) sweepOrphans(true);

  if (report.length === 0) {
    ctx.out("No Claude worktrees found under .claude/worktrees/.");
    git(["worktree", "prune"]);
    return 0;
  }
  ctx.out(report.join("\n"));
  ctx.out("");
  if (removable.length === 0) {
    ctx.out("Nothing to remove.");
    git(["worktree", "prune"]);
    return 0;
  }
  if (!apply) {
    ctx.out(
      `Dry run: ${String(removable.length)} worktree(s) would be removed. Re-run with --yes to remove them.`,
    );
    return 0;
  }
  removeRemovable(true);
  ctx.out("Done.");
  return 0;
};

export const realCtx = (env: Env = process.env): Ctx => ({
  cwd: process.cwd(),
  run: makeRun(env),
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
  now: () => Math.floor(Date.now() / 1000),
});

if (import.meta.main) process.exitCode = main(process.argv.slice(2), realCtx());
