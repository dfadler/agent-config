---
name: git-worktree-usage
description: |
  Git worktree and branch mechanics for isolating non-trivial work: creating
  worktrees with `EnterWorktree` (never raw `git worktree add`), locking and
  the stale-worktree sweep, picking what to parallelize by file surface, the
  repo-wide `git stash` collision hazard and its `git restore` alternative,
  branch naming, catching a branch up to a moved `main` via merge (not
  rebase), CI/coverage gotchas after a merge, conflict-resolution escalation
  levels, and PR-splitting sequencing. Use when creating, entering, or
  cleaning up a git worktree; deciding how to parallelize agent sessions
  across a repo; hitting a `git stash` collision between sessions; resolving
  a merge/rebase conflict; or splitting an already-written diff into
  multiple PRs.
license: MIT
metadata:
  version: "1.0.0"
---

# Git & worktree usage

This is the *mechanics* skill for git worktrees, branches, and conflict/PR-
splitting workflows — not the policy of *when* isolation is required (that
lives in your project's own CLAUDE.md; see the "Isolation: use git
worktrees for non-trivial work" section in this repo's global CLAUDE.md for
one example policy: use a worktree for anything beyond a one-line edit, and
never commit directly to the main working copy).

## Creating and managing worktrees

- **Create worktrees with the `EnterWorktree` tool, never raw `git worktree
  add`.** The tool applies whatever worktree conventions the repo has
  configured automatically — path/branch naming, locking (so a worktree in
  active use can't be collided into by another session), and any
  `worktree.symlinkDirectories` set in `.claude/settings.json` (e.g. a heavy
  `node_modules`/`vendor` directory), so a new worktree doesn't need its own
  copy. Raw `git worktree add` bypasses all of that — the tool exists
  because that bypass was a recurring source of pain: untracked directories
  re-copied by hand, and worktrees created outside the convention that a
  repo's own pruning tooling then can't find.
- **A subagent whose cwd was pinned at launch can't call `EnterWorktree`
  itself** — creating a worktree from inside one would mutate the parent
  session's process-wide working directory, and switching to an *existing*
  worktree by path fails too unless the subagent's own cwd already happens
  to be inside a worktree. So decide isolation at spawn time, not mid-task:
  pass `isolation: "worktree"` on the `Agent`-tool call (or the equivalent
  field in a persistent custom subagent's frontmatter) rather than having
  the subagent call `EnterWorktree` itself once it's already running —
  that's exactly the gap that pushes a subagent toward the raw-`git
  worktree add` fallback the bullet above warns against.
- **Glance at `git worktree list` periodically.** A worktree created via
  that raw-git fallback — including one a subagent was forced into before
  the point above applied — sits outside `EnterWorktree`'s bookkeeping, so
  it also sits outside Claude Code's automatic stale-worktree sweep,
  regardless of age (see the sweep's documented exceptions in the docs
  linked below). Nothing removes it but a manual `git worktree remove`.
- **Pick what to parallelize by file surface, not by ticket.** Two tasks
  that both touch shared config (a lint config, `package.json`, a shared
  component) will conflict at merge time even if the sessions never overlap
  in time — stagger those instead of running them side by side.
- **Kill worktree-scoped background processes before removing the
  worktree.** A dev/preview server or headless browser instance started
  against worktree files keeps running after the worktree is deleted —
  nothing ties its lifetime to the worktree's, and `preview_start`/
  `.claude/launch.json` resolves against the *original* repo root
  regardless of `EnterWorktree`'s cwd switch, so such a preview is
  typically a plain `Bash` `run_in_background` process nothing else tracks.
  Before `ExitWorktree` (or otherwise abandoning the worktree), check for
  and stop anything spawned against it. Prefer the PID captured at launch
  (the background-task PID a tool returns, or `$!`) over killing by port or
  name — two worktrees can each think of "the" dev server on a shared port
  as theirs without being the same process. No PID captured? Verify first —
  `lsof -i :<port>` before killing, never `lsof -ti` piped straight into
  `xargs kill`. `--headless` narrows a browser match but isn't unique to a
  worktree; confirm a session-specific marker (working directory, launch
  command, `--user-data-dir`) before killing, and skip an ambiguous match —
  a broad `pkill` on a generic pattern can hit the user's real browser too.
- **Name the branch `issue-<N>-<slug>` when a GitHub issue drives the work,
  or a bare `<slug>` otherwise, by passing it as `EnterWorktree`'s `name`
  argument** — an explicit `name` is used as given; the `worktree-`/
  `worktree-agent-<hash>` shape is only what the tool generates when `name`
  is omitted. Not adopting a Conventional-Branch `type/description` prefix
  (redundant with this repo's Conventional-Commit messages). Guidance, not
  enforcement, for now. Exclude `dependabot/*`. No retroactive renaming.

Several of the bullets above describe first-class, versioned tool behavior
(isolation enforcement, automatic locking, the sweep and its documented
exceptions) rather than conventions this repo invented — see the
[official Claude Code worktrees docs](https://code.claude.com/docs/en/worktrees),
which log roughly a dozen behavior changes across recent patches, so treat
this section as a convention layer over a moving target, not a snapshot of
it.

## The `git stash` collision hazard

- **If the main checkout is already dirtied before you realize you should
  be in a worktree, don't migrate the change with `git stash push --
  <file>`** on any file a concurrent session might also be editing (a
  shared README, a shared config) — stash pathspec operates on the whole
  file, so it sweeps up their in-progress hunks too, briefly removing their
  work and dragging it onto your branch. Instead, enter a clean worktree
  from the up-to-date default branch and re-apply only your own hunks
  there.
- **`git stash` is repo-wide, not per-worktree** — `refs/stash` lives in
  the shared `.git` directory, so two sessions in different worktrees
  pushing around the same time interleave into one stack, and a plain
  `git stash pop` in either one can pop the *other* session's entry,
  silently applying a stranger's diff into your working tree. For a scoped
  "revert these known files, then restore" need (e.g. a before/after
  screenshot), skip `git stash` entirely — `git restore --source=HEAD
  --worktree -- <files>` (Git 2.23+; touches only the worktree, unlike
  `git checkout HEAD -- <files>`, which also resets the index) plus a
  filesystem copy as your own backup never touches repo-wide state. If it
  already happened, check `git stash list`/`git stash show` first — a
  conflicted `pop` leaves the entry there. Only if it's genuinely gone is a
  stash entry just a dangling commit: `git fsck --no-reflog --unreachable
  --dangling`, then inspect candidates with `git show`/`git log` (fsck
  itself has no way to filter by message or date) to find the one matching
  your own `-m` text and a recent author-date, then `git stash apply <sha>`
  (never `pop`) once you've found your entry.

## CI and branch hygiene after a merge

- **After merging a PR that adds or tightens an enforcing CI rule** (a new
  lint rule, a stricter type check), re-run that check against a fresh
  default branch and sweep any stragglers in a follow-up — branches cut
  *before* the rule-adding PR merged carry violations their own (pre-rule)
  CI never saw, so the default branch can go red on merge despite every
  individual PR having been green. Watch the merge-timing race too:
  pushing a new commit to a just-merged (and deleted) branch re-creates it,
  so a final commit can *look* merged without actually being on the
  default branch — verify against the merge commit's parent, or the PR's
  own state, not the branch name.
- **A coverage gate can fail a PR that only adds tests, never removes
  any**, the first time it measures a file the coverage run had never
  executed before. A trace-based coverage tool (kcov, and others like it)
  treats never-executed code as invisible, not as a counted zero — a file
  the run never touches contributes nothing to the denominator, whether or
  not it has a dedicated test (indirect execution via another script's
  test counts too). The first PR to actually execute that file under
  coverage makes every line in it visible for the first time; if that new
  execution only exercises part of the file, the rest now drags the
  aggregate percentage down, and the floor can fail even though coverage
  strictly improved (dfadler/agent-config#106 is a real instance). The fix
  is to finish covering the newly-visible file, not to lower the threshold.
- **Squash merges mean a merged branch's commits aren't reachable by SHA on
  the local default branch** — cleanup tooling that checks reachability
  may warn a branch is "unmerged" when it's actually merged. Verify against
  the PR itself (state: merged), not a local branch-reachability check.

## Catching up a branch that already has an open PR

- **Once a branch has an open PR, catch it up to a moved `main` via merge,
  not rebase** — every merge in this repo's history already is one.
  Rewriting a branch under active review invalidates the PR's diff view
  and detaches anchored review comments (the golden-rule-of-rebasing
  reasoning). Rebase freely before a PR exists.

## Verifying a resolved conflict or a claimed-intact commit range

- **Before trusting a resolved conflict, or a PR claiming to carry a commit
  range forward intact, diff the result against the side it's supposed to
  match and name every surviving delta** (`git diff <split-branch>
  <source-branch> -- <paths>`, empty = safe) rather than trusting a
  read-through — this also catches a dropped commit when splitting.

## Conflict resolution: when to escalate

Give conflict resolution the same three-way shape `pr-babysit`'s
`address-reviews` step already uses for review comments, instead of
treating "merge, resolve, commit, push" as unconditional:

- **Resolve confidently** when both sides' intent traces to a primary
  source (a commit, PR, or issue) and reconciles without inventing
  unspecified behavior.
- **Resolve with a named trade-off**, stated in the commit message, when
  reconciling needs a judgment call (e.g. one side wins because it matches
  the merge's goal).
- **Escalate** — only when neither side's intent is recoverable, or it's a
  genuine product decision rather than a text-reconciliation problem. Pause
  the merge in place rather than `--abort`ing it, but never stage or commit
  a file that still contains `<<<<<<<`/`=======`/`>>>>>>>` markers; write
  the ambiguity summary somewhere other than the conflicted file itself.

The diff-against-claimed-source check above applies to whichever of the
three a conflict lands in.

## Splitting a large or already-written PR

- **Default to sequential PRs against `main`, coordinated in prose** — a
  `## Sequencing` section in the PR body naming every related PR and what
  happens under each merge order.
- **Reserve branch-off-branch PRs (`gh pr create --base <other-pr-branch>`)
  for the rare case of two split pieces in flight at once** — no extra
  tooling needed, but if the base PR's branch changes underneath it, catch
  the dependent branch up by merging the base branch in, the same as the
  merge-not-rebase rule above (never `git rebase --onto` a dependent branch
  that already has its own open PR).
- **When mechanically splitting an already-written diff, re-verify the
  claimed range against the source branch's live tip before opening the
  PR, and never cherry-pick from a locked worktree** — a lock means "still
  changing," not "safe to snapshot" (dfadler/agent-config#65 shipped a
  known leak this way). Use the diff-against-claimed-source check above to
  confirm a claimed range landed intact.
