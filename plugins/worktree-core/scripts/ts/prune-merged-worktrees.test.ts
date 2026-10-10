import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeRun } from "./proc.ts";
import {
  main,
  markerBlockBounds,
  ORPHAN_GRACE_SECONDS,
  type Ctx,
} from "./prune-merged-worktrees.ts";
import { makeSandbox, put, type Sandbox } from "./test-helpers.ts";

let sb: Sandbox;
beforeEach(() => {
  sb = makeSandbox();
});
afterEach(() => {
  sb.cleanup();
});

interface Out {
  code: number;
  out: string;
  err: string;
}

/** Run main() from `cwd` (default: the main checkout) with the sandbox env. */
const go = (
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Out => {
  const out: string[] = [];
  const err: string[] = [];
  const ctx: Ctx = {
    cwd: opts.cwd ?? sb.repo,
    run: makeRun({ ...sb.env, ...opts.env }),
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    now: () => Math.floor(Date.now() / 1000),
  };
  const code = main(args, ctx);
  return { code, out: out.join("\n"), err: err.join("\n") };
};

/** A pushed, clean worktree whose PR is recorded as merged. */
const mergedWorktree = (name: string, branch?: string): string => {
  const p = sb.addWorktree(name, branch);
  sb.markMerged(branch ?? `worktree-${name}`, sb.head(p));
  return p;
};

const branches = (): string => sb.git(sb.repo, "branch", "--list");

describe("classification (dry run)", () => {
  it("reports a merged, clean, pushed worktree as REMOVE and removes nothing", () => {
    const p = mergedWorktree("a");
    const r = go([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/REMOVE {2}\.claude\/worktrees\/a — worktree-a merged/);
    expect(r.out).toMatch(/Dry run: 1 worktree\(s\) would be removed/);
    expect(existsSync(p)).toBe(true);
  });

  it("keeps a merged worktree with uncommitted changes", () => {
    const p = mergedWorktree("a");
    put(join(p, "dirty.txt"), "x");
    expect(go([]).out).toMatch(/keep {4}\.claude\/worktrees\/a — uncommitted changes/);
  });

  it("keeps a merged worktree with an unpushed commit", () => {
    const p = sb.addWorktree("a");
    sb.git(p, "commit", "-q", "--allow-empty", "-m", "more");
    sb.markMerged("worktree-a", sb.head(p));
    expect(go([]).out).toMatch(/unpushed commits \(or no upstream\)/);
  });

  it("keeps a worktree with no merged PR", () => {
    sb.addWorktree("a");
    expect(go([]).out).toMatch(/no merged PR for worktree-a/);
  });

  it("keeps a worktree whose branch name was reused at a different commit", () => {
    const p = sb.addWorktree("a");
    sb.markMerged("worktree-a", "0".repeat(40));
    const r = go(["--yes"]);
    expect(r.out).toMatch(/no merged PR for worktree-a/);
    expect(existsSync(p)).toBe(true);
  });

  it("keeps a locked worktree", () => {
    const p = mergedWorktree("a");
    sb.git(sb.repo, "worktree", "lock", p);
    expect(go([]).out).toMatch(/locked \(another session is using it\)/);
  });

  it("keeps the worktree the script runs from", () => {
    const p = mergedWorktree("a");
    expect(go([], { cwd: p }).out).toMatch(/current session/);
    expect(existsSync(p)).toBe(true);
  });

  it("ignores worktrees outside .claude/worktrees/ or on other branches", () => {
    const outside = join(sb.root, "elsewhere");
    sb.git(sb.repo, "worktree", "add", "-q", "-b", "worktree-out", outside);
    sb.git(sb.repo, "worktree", "add", "-q", "-b", "feature-x", join(sb.repo, ".claude", "worktrees", "f"));
    const r = go([]);
    expect(r.out).toBe("No Claude worktrees found under .claude/worktrees/.");
  });

  it("says nothing to remove when everything must be kept", () => {
    sb.addWorktree("a");
    expect(go([]).out).toMatch(/Nothing to remove\./);
  });

  it("handles claude/* branches like worktree-* branches", () => {
    mergedWorktree("c", "claude/competent-x");
    expect(go([]).out).toMatch(/REMOVE .*claude\/competent-x merged/);
  });
});

describe("upstream handling", () => {
  it("still removes when the origin branch was auto-deleted", () => {
    mergedWorktree("a");
    sb.git(sb.repo, "push", "-q", "origin", "--delete", "worktree-a");
    expect(go([]).out).toMatch(/REMOVE/);
  });

  it("no upstream, HEAD already on main: removable", () => {
    const p = join(sb.repo, ".claude", "worktrees", "n");
    sb.git(sb.repo, "worktree", "add", "-q", "-b", "worktree-n", p);
    sb.markMerged("worktree-n", sb.head(p));
    expect(go([]).out).toMatch(/REMOVE/);
  });

  it("no upstream and a real unpushed commit: kept", () => {
    const p = join(sb.repo, ".claude", "worktrees", "n");
    sb.git(sb.repo, "worktree", "add", "-q", "-b", "worktree-n", p);
    sb.git(p, "commit", "-q", "--allow-empty", "-m", "unique");
    sb.markMerged("worktree-n", sb.head(p));
    expect(go([]).out).toMatch(/unpushed commits \(or no upstream\)/);
  });
});

describe("modes", () => {
  it("--yes removes the merged worktree and its branch, leaves the rest", () => {
    const a = mergedWorktree("a");
    const b = sb.addWorktree("b");
    const r = go(["--yes"]);
    expect(r.out).toMatch(/==> Removing .*\/a \(worktree-a\)/);
    expect(r.out).toMatch(/Done\./);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(true);
    expect(branches()).not.toMatch(/worktree-a/);
    expect(branches()).toMatch(/worktree-b/);
  });

  it("--hook lists removable worktrees but removes nothing, even with --yes", () => {
    const a = mergedWorktree("a");
    const r = go(["--hook", "--yes"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/1 merged worktree\(s\) can be cleaned up/);
    expect(r.out).toMatch(/• worktree-a/);
    expect(existsSync(a)).toBe(true);
  });

  it("--hint prints the enable nudge for merged worktrees and removes nothing", () => {
    const p = mergedWorktree("a");
    const r = go(["--hint", "--yes"]);
    expect(r).toEqual({
      code: 0,
      out: "🧹 1 merged worktree(s) could be pruned; set worktree.autoPrune to enable",
      err: "",
    });
    expect(existsSync(p)).toBe(true);
  });

  it("--hint is silent with no other Claude worktree, without calling gh", () => {
    const real = makeRun(sb.env);
    const called: string[] = [];
    const ctx: Ctx = {
      cwd: sb.repo,
      run: (cmd, args, at) => {
        called.push(cmd);
        return real(cmd, args, at);
      },
      out: (l) => called.push(`out:${l}`),
      err: (l) => called.push(`err:${l}`),
      now: () => 0,
    };
    expect(main(["--hint"], ctx)).toBe(0);
    expect(called.filter((c) => c !== "git")).toEqual([]);
  });

  it("--hint is silent when the only worktree is unmerged", () => {
    sb.addWorktree("a");
    expect(go(["--hint"])).toEqual({ code: 0, out: "", err: "" });
  });

  it("--hook is silent when nothing is removable", () => {
    sb.addWorktree("a");
    expect(go(["--hook"])).toEqual({ code: 0, out: "", err: "" });
  });

  it("--auto removes only the merged worktree and prints a short summary", () => {
    const a = mergedWorktree("a");
    const b = sb.addWorktree("b");
    const r = go(["--auto"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("🧹 Removed 1 merged worktree(s):\n   • worktree-a");
    expect(existsSync(a)).toBe(false);
    expect(existsSync(b)).toBe(true);
  });

  it("--auto never removes the current session's worktree and is silent otherwise", () => {
    const a = mergedWorktree("a");
    expect(go(["--auto"], { cwd: a })).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(a)).toBe(true);
  });

  it("rejects an unknown option", () => {
    const r = go(["--bogus"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Unknown option: --bogus/);
  });

  it("--help prints only the header block", () => {
    const r = go(["--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^Remove local git worktrees/);
    expect(r.out).toMatch(/Usage:/);
    expect(r.out).not.toMatch(/import /);
    expect(r.out).not.toMatch(/First failing rule/);
  });
});

describe("fail closed on gh problems", () => {
  it("human run: aborts without changes when the merged-PR fetch fails", () => {
    const a = mergedWorktree("a");
    const r = go(["--yes"], { env: { GH_LIST_EXIT: "1" } });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Couldn't fetch merged PRs/);
    expect(existsSync(a)).toBe(true);
  });

  it("junk (non-JSON) output from gh is treated as a failed fetch", () => {
    const a = mergedWorktree("a");
    writeFileSync(sb.env["GH_MERGED_FILE"] ?? "", "not json");
    expect(go(["--auto"])).toEqual({ code: 0, out: "", err: "" });
    expect(go([]).code).toBe(1);
    writeFileSync(sb.env["GH_MERGED_FILE"] ?? "", '{"not":"an array"}');
    expect(go([]).code).toBe(1);
    expect(existsSync(a)).toBe(true);
  });

  it("hook modes stay silent, exit 0 and remove nothing when the fetch fails", () => {
    const a = mergedWorktree("a");
    expect(go(["--auto"], { env: { GH_LIST_EXIT: "1" } })).toEqual({ code: 0, out: "", err: "" });
    expect(go(["--hook"], { env: { GH_LIST_EXIT: "1" } })).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(a)).toBe(true);
  });

  it("unauthenticated gh: clear error for humans, silent for hooks", () => {
    const a = mergedWorktree("a");
    const human = go([], { env: { GH_AUTH_EXIT: "1" } });
    expect(human.code).toBe(1);
    expect(human.err).toMatch(/GitHub CLI, authenticated/);
    expect(go(["--auto"], { env: { GH_AUTH_EXIT: "1" } })).toEqual({ code: 0, out: "", err: "" });
    expect(existsSync(a)).toBe(true);
  });

  it("missing gh behaves like unauthenticated", () => {
    mergedWorktree("a");
    const env = { PATH: "/usr/bin:/bin" };
    // makeRun uses only the env given; strip the shim dir so gh is absent.
    const r = go([], { env });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/GitHub CLI/);
  });

  it("outside a git repository: error for humans, silent exit 0 for hooks", () => {
    expect(go([], { cwd: sb.root }).err).toBe("Not inside a git repository.");
    expect(go([], { cwd: sb.root }).code).toBe(1);
    expect(go(["--auto"], { cwd: sb.root })).toEqual({ code: 0, out: "", err: "" });
  });
});

describe("markerBlockBounds", () => {
  const b = "<!-- B -->";
  const e = "<!-- E -->";
  it("finds a well-formed block (1-indexed)", () => {
    expect(markerBlockBounds(`x\n\n${b}\nbody\n${e}\n`, b, e)).toEqual({ begin: 3, end: 5 });
  });
  it("fails without a begin marker", () => {
    expect(markerBlockBounds(`x\n${e}\n`, b, e)).toBeUndefined();
  });
  it("fails on an unclosed block", () => {
    expect(markerBlockBounds(`x\n${b}\nbody\n`, b, e)).toBeUndefined();
  });
  it("fails when the only end marker precedes the begin marker", () => {
    expect(markerBlockBounds(`${e}\n${b}\n`, b, e)).toBeUndefined();
  });
  it("uses the LAST end marker at or after the begin marker", () => {
    expect(markerBlockBounds(`a\n${b}\n${e}\nmid\n${e}\n`, b, e)).toEqual({ begin: 2, end: 5 });
  });
});

describe("cruft marker revert", () => {
  const BEGIN = "<!-- BEGIN:x -->";
  const END = "<!-- END:x -->";
  const block = `${BEGIN}\ngenerated\n${END}\n`;
  let wt: string;

  /** Track CLAUDE.md in the main repo, then make a merged worktree. */
  const setup = (cfg: unknown = [{ path: "CLAUDE.md", beginMarker: BEGIN, endMarker: END }]): void => {
    put(join(sb.repo, "CLAUDE.md"), "# Title\n\nbody\n");
    put(
      join(sb.repo, ".claude", "settings.json"),
      JSON.stringify({ worktree: { autoPruneCruftMarkers: cfg } }),
    );
    sb.git(sb.repo, "add", "CLAUDE.md");
    sb.git(sb.repo, "commit", "-q", "-m", "claude");
    sb.git(sb.repo, "push", "-q", "origin", "main");
    wt = mergedWorktree("m");
  };
  const file = (): string => join(wt, "CLAUDE.md");
  const append = (text: string): void => {
    writeFileSync(file(), readFileSync(file(), "utf8") + text);
  };

  it("a dry run previews REMOVE without reverting", () => {
    setup();
    append(`\n${block}`);
    expect(go([]).out).toMatch(/REMOVE/);
    expect(readFileSync(file(), "utf8")).toContain(BEGIN);
  });

  it.each(["--yes", "--auto"])("%s reverts an exact appended block and removes", (flag) => {
    setup();
    append(`\n${block}`);
    go([flag]);
    expect(existsSync(wt)).toBe(false);
  });

  it("--yes reverts an exact block even when staged", () => {
    setup();
    append(`\n${block}`);
    sb.git(wt, "add", "CLAUDE.md");
    go(["--yes"]);
    expect(existsSync(wt)).toBe(false);
  });

  it.each(["--yes", "--auto"])("%s keeps a real note after the closing marker", (flag) => {
    setup();
    append(`\n${block}my note\n`);
    go([flag]);
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(file(), "utf8")).toContain("my note");
  });

  it.each(["--yes", "--auto"])("%s keeps a real edit hiding on the blank separator line", (flag) => {
    setup();
    append(`real edit\n${block}`);
    go([flag]);
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(file(), "utf8")).toContain("real edit");
  });

  it("keeps a real edit elsewhere in the file", () => {
    setup();
    writeFileSync(file(), "# Changed\n\nbody\n");
    go(["--yes"]);
    expect(existsSync(wt)).toBe(true);
  });

  it.each(["--yes", "--auto"])("%s keeps a worktree whose marker file was deleted", (flag) => {
    setup();
    rmSync(file());
    go([flag]);
    expect(existsSync(wt)).toBe(true);
  });

  it("an entry missing endMarker is ignored, so the block counts as dirty", () => {
    setup([{ path: "CLAUDE.md", beginMarker: BEGIN }]);
    append(`\n${block}`);
    go(["--yes"]);
    expect(existsSync(wt)).toBe(true);
  });

  it("without config a marker-shaped diff is ordinary dirt", () => {
    setup([]);
    append(`\n${block}`);
    expect(go([]).out).toMatch(/uncommitted changes/);
  });

  it("never reverts the marker file when another file is also dirty", () => {
    setup();
    append(`\n${block}`);
    put(join(wt, "other.txt"), "x");
    go(["--yes"]);
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(file(), "utf8")).toContain(BEGIN);
  });

  it("never reverts the marker file when the branch has an unpushed commit", () => {
    setup();
    sb.git(wt, "commit", "-q", "--allow-empty", "-m", "unpushed");
    sb.markMerged("worktree-m", sb.head(wt));
    append(`\n${block}`);
    go(["--yes"]);
    expect(existsSync(wt)).toBe(true);
    expect(readFileSync(file(), "utf8")).toContain(BEGIN);
  });
});

describe("orphaned directory sweep", () => {
  const orphan = (name: string, ageSeconds = ORPHAN_GRACE_SECONDS + 60): string => {
    const d = join(sb.repo, ".claude", "worktrees", name);
    mkdirSync(join(d, "sub"), { recursive: true });
    const t = Date.now() / 1000 - ageSeconds;
    utimesSync(d, t, t);
    return d;
  };

  it("a dry run never removes an empty orphan", () => {
    const d = orphan("o");
    go([]);
    expect(existsSync(d)).toBe(true);
  });

  it.each(["--yes", "--auto"])("%s removes an old empty orphan and reports it", (flag) => {
    const d = orphan("o");
    const r = go([flag]);
    expect(existsSync(d)).toBe(false);
    if (flag === "--auto") expect(r.out).toMatch(/Removed 1 orphaned worktree director\(ies\):\n {3}• \.claude\/worktrees\/o/);
  });

  it("leaves a non-empty orphan alone", () => {
    const d = orphan("o");
    put(join(d, "sub", "file.txt"), "x");
    go(["--yes"]);
    expect(existsSync(d)).toBe(true);
  });

  it("leaves a young orphan alone", () => {
    const d = orphan("o", 5);
    go(["--yes"]);
    expect(existsSync(d)).toBe(true);
  });

  it("leaves an old directory holding only a symlink alone", () => {
    const d = orphan("o");
    symlinkSync(sb.repo, join(d, "sub", "link"));
    go(["--yes"]);
    expect(existsSync(d)).toBe(true);
  });

  it("never sweeps a top-level symlink (conservative vs. the old shell)", () => {
    const target = join(sb.root, "real-target");
    mkdirSync(target);
    mkdirSync(join(sb.repo, ".claude", "worktrees"), { recursive: true });
    const link = join(sb.repo, ".claude", "worktrees", "l");
    symlinkSync(target, link);
    go(["--yes"]);
    expect(existsSync(link)).toBe(true);
  });

  it("never sweeps a registered (kept) worktree", () => {
    const p = sb.addWorktree("kept");
    go(["--yes"]);
    expect(existsSync(p)).toBe(true);
  });
});
