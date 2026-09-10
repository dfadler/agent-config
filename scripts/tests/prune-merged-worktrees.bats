#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# prune-merged-worktrees.sh — the classification logic that decides which
# Claude worktrees are safe to remove (merged + clean + pushed) and which to
# keep (current / locked / unmerged / dirty / unpushed).
#
# Fully hermetic: `gh` is a local fixture-driven shim (make_worktree_sandbox),
# the network is blocked, and `git` only ever touches a throwaway repo under a
# temp dir. See helpers.bash.

load helpers

setup() {
  make_worktree_sandbox
}

teardown() {
  destroy_sandbox
}

# --- classification (dry run reports, removes nothing) ----------------------

@test "reports a merged, clean, pushed worktree as REMOVE (dry run)" {
  add_worktree done merged-clean >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "REMOVE"
  assert_output_contains "worktree-done merged"
  assert_output_contains "Dry run"
  # Dry run must not actually remove it.
  [ -d "$REPO/.claude/worktrees/done" ]
}

@test "keeps a merged worktree with uncommitted changes" {
  add_worktree dirty merged-dirty >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "keep"
  assert_output_contains "uncommitted changes"
  refute_output_contains "REMOVE"
}

@test "keeps a merged worktree with unpushed commits / no upstream" {
  add_worktree ahead merged-unpushed >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "unpushed commits"
  refute_output_contains "REMOVE"
}

@test "keeps a worktree with no merged PR" {
  add_worktree wip unmerged >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "no merged PR for worktree-wip"
  refute_output_contains "REMOVE"
}

@test "keeps a locked worktree even when its PR is merged" {
  add_worktree busy locked >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "locked"
  refute_output_contains "REMOVE"
}

@test "keeps the worktree the script is being run from (current session)" {
  local wt
  wt="$(add_worktree here current)"

  run prune "$wt"

  assert_success
  assert_output_contains "current session"
  refute_output_contains "REMOVE"
}

# --- scope guardrails -------------------------------------------------------

@test "ignores a worktree outside .claude/worktrees/ (wrong path)" {
  add_out_of_scope_worktree path >/dev/null

  run prune "$REPO"

  assert_success
  refute_output_contains "outside"
  assert_output_contains "No Claude worktrees found"
}

@test "ignores a worktree that is not on a worktree-* branch (wrong branch)" {
  add_out_of_scope_worktree branch >/dev/null

  run prune "$REPO"

  assert_success
  refute_output_contains "feature-thing"
  assert_output_contains "No Claude worktrees found"
}

@test "reports nothing to remove when the only worktrees must be kept" {
  add_worktree wip unmerged >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "Nothing to remove"
}

# --- hook mode (quiet, read-only nudge) -------------------------------------

@test "--hook lists removable worktrees but removes nothing" {
  add_worktree done merged-clean >/dev/null

  run prune "$REPO" --hook

  assert_success
  assert_output_contains "can be cleaned up"
  assert_output_contains "worktree-done"
  assert_output_contains "--yes"
  [ -d "$REPO/.claude/worktrees/done" ]
}

@test "--hook is silent when nothing is removable" {
  add_worktree wip unmerged >/dev/null

  run prune "$REPO" --hook

  assert_success
  [ -z "$output" ]
}

@test "--hook forces dry run even with --yes present" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null

  run prune "$REPO" --hook --yes

  assert_success
  [ -d "$wt" ]
}

# --- auto mode (quiet SessionStart auto-remove) -----------------------------

@test "--auto removes a merged worktree and prints a short summary" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  [ -d "$wt" ]

  run prune "$REPO" --auto

  assert_success
  assert_output_contains "Removed 1 merged worktree(s)"
  assert_output_contains "worktree-done"
  [ ! -d "$wt" ]
  # Its local branch is gone too.
  run git -C "$REPO" rev-parse --verify --quiet "refs/heads/worktree-done"
  assert_failure
}

@test "--auto never prints the verbose report table or dry-run wording" {
  add_worktree done merged-clean >/dev/null

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "==> Removing"
  refute_output_contains "Dry run"
}

@test "--auto removes only the merged worktree and leaves the rest in place" {
  local removable="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  add_worktree wip unmerged >/dev/null
  add_worktree dirty merged-dirty >/dev/null
  add_worktree busy locked >/dev/null

  run prune "$REPO" --auto

  assert_success
  [ ! -d "$removable" ]
  [ -d "$REPO/.claude/worktrees/wip" ]
  [ -d "$REPO/.claude/worktrees/dirty" ]
  [ -d "$REPO/.claude/worktrees/busy" ]
}

@test "--auto never removes the current session's own worktree" {
  local wt
  wt="$(add_worktree here current)"

  run prune "$wt" --auto

  assert_success
  [ -d "$wt" ]
  refute_output_contains "Removed"
}

@test "--auto is silent when nothing is removable" {
  add_worktree wip unmerged >/dev/null

  run prune "$REPO" --auto

  assert_success
  [ -z "$output" ]
}

@test "--auto stays silent and exits 0 (removing nothing) when gh pr list fails" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null

  GH_PR_LIST_FAILS=1 run prune "$REPO" --auto

  assert_success
  [ -z "$output" ]
  # Fail-closed: the worktree must survive a gh error.
  [ -d "$wt" ]
}

@test "--auto stays silent and exits 0 when gh is not authenticated" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null

  GH_UNAUTHENTICATED=1 run prune "$REPO" --auto

  assert_success
  [ -z "$output" ]
  [ -d "$wt" ]
}

@test "--auto exits 0 silently when not inside a git repository" {
  run prune "$SANDBOX" --auto

  assert_success
  [ -z "$output" ]
}

# --- auto-deleted head branch (GitHub's delete_branch_on_merge = true) -------
# A repo with GitHub's "Automatically delete head branches" on has, at session
# start, a merged worktree whose origin branch is already gone while its local
# remote-tracking ref is still stale. That is the COMMON case, not an edge
# case — the merge signal comes live from `gh pr list`, and the worktree stays
# removable as long as the script doesn't prune the stale upstream ref out
# from under the @{u} check.

@test "reports REMOVE for a merged worktree whose origin branch was auto-deleted (dry run)" {
  add_worktree done merged-clean >/dev/null
  delete_origin_branch done

  run prune "$REPO"

  assert_success
  assert_output_contains "REMOVE"
  assert_output_contains "worktree-done merged"
  refute_output_contains "unpushed commits"
}

@test "--yes removes a merged worktree whose origin branch was auto-deleted" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  delete_origin_branch done

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
}

@test "--auto removes a merged worktree whose origin branch was auto-deleted" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  delete_origin_branch done

  run prune "$REPO" --auto

  assert_success
  assert_output_contains "Removed 1 merged worktree(s)"
  [ ! -d "$wt" ]
}

# --- reused branch name (headRefOid must match, not just headRefName) ------
# `gh pr list --state merged` keeps returning an OLD PR's record forever,
# even after its branch name is reused by a new, unrelated, still-open PR —
# it's a fact about a past PR, not about what the branch currently points at.
# Matching by headRefName alone would wrongly REMOVE the new worktree.

@test "does not remove a worktree whose branch name was reused by an unrelated later PR" {
  local old_oid
  old_oid="$(git -C "$REPO" rev-parse HEAD)"
  _mark_merged "worktree-foo" "$old_oid"

  # A new commit on main, so the reused branch starts from a genuinely
  # different tip than the earlier (already-merged) one did.
  git -C "$REPO" commit -q --allow-empty -m "unrelated later work"

  local wt="$REPO/.claude/worktrees/foo"
  git -C "$REPO" worktree add -q -b "worktree-foo" "$wt" main
  git -C "$wt" push -q -u origin "worktree-foo"

  run prune "$REPO"

  assert_success
  refute_output_contains "REMOVE"
  assert_output_contains "no merged PR for worktree-foo"
  [ -d "$wt" ]
}

@test "--auto never removes a worktree whose branch name was reused by an unrelated later PR" {
  local old_oid
  old_oid="$(git -C "$REPO" rev-parse HEAD)"
  _mark_merged "worktree-foo" "$old_oid"

  git -C "$REPO" commit -q --allow-empty -m "unrelated later work"

  local wt="$REPO/.claude/worktrees/foo"
  git -C "$REPO" worktree add -q -b "worktree-foo" "$wt" main
  git -C "$wt" push -q -u origin "worktree-foo"

  run prune "$REPO" --auto

  assert_success
  [ -d "$wt" ]
  refute_output_contains "Removed"
}

@test "removes a worktree once its own commit genuinely matches the merged PR's head" {
  # Sanity check for the oid-matching change itself: the ordinary merged case
  # (branch AND commit both match) must still be removable, not just the
  # reused-name case correctly kept.
  local wt="$REPO/.claude/worktrees/foo"
  git -C "$REPO" worktree add -q -b "worktree-foo" "$wt" main
  git -C "$wt" push -q -u origin "worktree-foo"
  _mark_merged "worktree-foo" "$(git -C "$wt" rev-parse HEAD)"

  run prune "$REPO" --yes

  assert_success
  [ ! -d "$wt" ]
}

# --- gh failure handling (fail closed for humans, silent for the hook) ------

@test "aborts without changes when gh pr list fails (human run)" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null

  GH_PR_LIST_FAILS=1 run prune "$REPO" --yes

  assert_failure
  assert_output_contains "Couldn't fetch merged PRs"
  # Fail-closed: the worktree must survive a gh error.
  [ -d "$wt" ]
}

@test "hook stays silent and exits 0 when gh pr list fails" {
  add_worktree done merged-clean >/dev/null

  GH_PR_LIST_FAILS=1 run prune "$REPO" --hook

  assert_success
  [ -z "$output" ]
}

@test "errors clearly when gh is not authenticated (human run)" {
  add_worktree done merged-clean >/dev/null

  GH_UNAUTHENTICATED=1 run prune "$REPO"

  assert_failure
  assert_output_contains "GitHub CLI, authenticated"
}

@test "hook exits 0 silently when gh is not authenticated" {
  add_worktree done merged-clean >/dev/null

  GH_UNAUTHENTICATED=1 run prune "$REPO" --hook

  assert_success
  [ -z "$output" ]
}

# --- argument / environment handling ----------------------------------------

@test "rejects an unknown option" {
  run prune "$REPO" --bogus

  assert_failure
  assert_output_contains "Unknown option"
}

@test "--help prints usage and exits 0" {
  run prune "$REPO" --help

  assert_success
  assert_output_contains "Usage:"
  assert_output_contains "prune-merged-worktrees.sh"
}

@test "help output stops at the header block and doesn't leak body comments" {
  run prune "$REPO" --help

  assert_success
  # A real comment deeper in the script (the removal loop's per-item chatter
  # explanation) is not user-facing usage docs, so --help must not print it.
  refute_output_contains "controls per-item chatter"
}

@test "errors when not inside a git repository (human run)" {
  run prune "$SANDBOX"

  assert_failure
  assert_output_contains "Not inside a git repository"
}

@test "hook exits 0 when not inside a git repository" {
  run prune "$SANDBOX" --hook

  assert_success
  [ -z "$output" ]
}

# --- apply mode (--yes) actually removes, and only the right ones -----------

@test "--yes removes a merged worktree and deletes its branch" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  [ -d "$wt" ]

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
  # Its local branch is gone too.
  run git -C "$REPO" rev-parse --verify --quiet "refs/heads/worktree-done"
  assert_failure
}

@test "--yes removes only the merged worktree and leaves the rest in place" {
  local removable="$REPO/.claude/worktrees/done"
  add_worktree done merged-clean >/dev/null
  add_worktree wip unmerged >/dev/null
  add_worktree dirty merged-dirty >/dev/null
  add_worktree busy locked >/dev/null

  run prune "$REPO" --yes

  assert_success
  [ ! -d "$removable" ]
  [ -d "$REPO/.claude/worktrees/wip" ]
  [ -d "$REPO/.claude/worktrees/dirty" ]
  [ -d "$REPO/.claude/worktrees/busy" ]
}

# --- desktop-app claude/* worktrees -----------------------------------------
# The desktop app creates sessions under .claude/worktrees/ on auto-generated
# `claude/*` branches (e.g. claude/competent-fermi-33e7a1), where the worktree
# directory name and the branch name deliberately differ. These must be pruned
# on merge exactly like the `worktree-*` ones.

@test "reports REMOVE for a merged claude/* worktree (dry run)" {
  add_worktree wonderfulfermat merged-clean claude/competent-fermi-33e7a1 >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "REMOVE"
  assert_output_contains "claude/competent-fermi-33e7a1 merged"
  assert_output_contains "Dry run"
  # Dry run must not actually remove it.
  [ -d "$REPO/.claude/worktrees/wonderfulfermat" ]
}

@test "--yes removes a merged claude/* worktree and deletes its branch" {
  local wt="$REPO/.claude/worktrees/wonderfulfermat"
  add_worktree wonderfulfermat merged-clean claude/competent-fermi-33e7a1 >/dev/null
  [ -d "$wt" ]

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
  # Its local claude/* branch is gone too.
  run git -C "$REPO" rev-parse --verify --quiet "refs/heads/claude/competent-fermi-33e7a1"
  assert_failure
}

@test "--auto removes a merged claude/* worktree" {
  local wt="$REPO/.claude/worktrees/wonderfulfermat"
  add_worktree wonderfulfermat merged-clean claude/competent-fermi-33e7a1 >/dev/null

  run prune "$REPO" --auto

  assert_success
  assert_output_contains "Removed 1 merged worktree(s)"
  assert_output_contains "claude/competent-fermi-33e7a1"
  [ ! -d "$wt" ]
}

@test "keeps a locked claude/* worktree even when its PR is merged" {
  add_worktree busyfermat locked claude/busy-fermi-abc123 >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "locked"
  refute_output_contains "REMOVE"
}

@test "keeps an unmerged claude/* worktree" {
  add_worktree wipfermat unmerged claude/wip-fermi-def456 >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "no merged PR for claude/wip-fermi-def456"
  refute_output_contains "REMOVE"
}

@test "ignores a claude/* worktree outside .claude/worktrees/ (path scope)" {
  git -C "$REPO" worktree add -q -b "claude/outside-fermi-000" "$SANDBOX/outside-claude" main
  git -C "$SANDBOX/outside-claude" push -q -u origin "claude/outside-fermi-000"
  _mark_merged "claude/outside-fermi-000" "$(git -C "$SANDBOX/outside-claude" rev-parse HEAD)"

  run prune "$REPO"

  assert_success
  refute_output_contains "outside-fermi"
  assert_output_contains "No Claude worktrees found"
}

# --- hermeticity guard ------------------------------------------------------

@test "the sandbox blocks real network tools" {
  run curl https://example.com

  assert_failure
  assert_output_contains "network blocked in tests"
}
