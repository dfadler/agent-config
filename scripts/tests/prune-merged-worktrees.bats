#!/usr/bin/env bats
#
# Tests for plugins/worktree-core/skills/git-worktree-usage/scripts/
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

# --- no-upstream-but-already-on-main fallback --------------------------------
# A worktree branch is often never individually pushed — the branch a PR
# actually merged from can be a different name entirely. `is_merged` already
# confirmed via `gh` that SOME branch under this name merged at this exact
# commit; if this branch's HEAD is also already an ancestor of main, it has
# no unique content either way, upstream or not.

@test "reports REMOVE for a merged worktree with no upstream whose HEAD is already on main (dry run)" {
  add_worktree done merged-no-upstream-clean >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "REMOVE"
  refute_output_contains "unpushed commits"
}

@test "--yes removes a merged worktree with no upstream whose HEAD is already on main" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-no-upstream-clean >/dev/null

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
}

@test "keeps a merged worktree with no upstream and a real unpushed commit" {
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-unpushed >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
}

# --- marker_block_bounds (pure, unit-level) ----------------------------------
# Direct tests against the extracted pure predicate, via the marker_block_bounds
# helper in helpers.bash — plain temp files, no git/worktree/gh at all. This
# is the actual point of extracting it out of file_diff_is_only_marker_block:
# every edge case below used to need the full add_worktree integration
# fixture to exercise; now it's a 3-argument function call against a file.

@test "marker_block_bounds: finds a well-formed block and prints begin/end lines" {
  local f="$SANDBOX/f.txt"
  printf 'one\ntwo\nBEGIN\nthree\nEND\n' >"$f"
  run marker_block_bounds "$f" BEGIN END
  assert_success
  [ "$output" = "$(printf '3\t5')" ]
}

@test "marker_block_bounds: fails when the begin marker is absent" {
  local f="$SANDBOX/f.txt"
  printf 'one\ntwo\nEND\n' >"$f"
  run marker_block_bounds "$f" BEGIN END
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "marker_block_bounds: fails on an unclosed block (begin present, no end)" {
  local f="$SANDBOX/f.txt"
  printf 'one\nBEGIN\ntwo\n' >"$f"
  run marker_block_bounds "$f" BEGIN END
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "marker_block_bounds: fails when the end marker's only occurrence is before the begin marker" {
  # Guards against a coincidental earlier occurrence computing a nonsensical
  # negative-length span.
  local f="$SANDBOX/f.txt"
  printf 'END\none\nBEGIN\ntwo\n' >"$f"
  run marker_block_bounds "$f" BEGIN END
  [ "$status" -ne 0 ]
  [ -z "$output" ]
}

@test "marker_block_bounds: uses the LAST end marker at or after the begin marker" {
  local f="$SANDBOX/f.txt"
  printf 'BEGIN\none\nEND\ntwo\nEND\n' >"$f"
  run marker_block_bounds "$f" BEGIN END
  assert_success
  [ "$output" = "$(printf '1\t5')" ]
}

# --- config-driven cruft-marker revert ---------------------------------------
# A project may declare, in its own .claude/settings.json, a tracked file
# whose diff is safe to revert before the clean check IFF the entire diff is
# exactly an appended marker-delimited block (see the script's own header).
# The revert only ever fires once every OTHER REMOVE condition already holds —
# reverting first and classifying after would mutate a worktree the script
# ends up keeping for an unrelated reason.

@test "with no marker configured, a marker-shaped diff is just an ordinary dirty file" {
  add_worktree done merged-marker-block >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "uncommitted changes"
  refute_output_contains "REMOVE"
}

@test "a dry run reports the marker block as uncommitted and never reverts it" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block >/dev/null

  run prune "$REPO"

  assert_success
  assert_output_contains "uncommitted changes"
  refute_output_contains "REMOVE"
  grep -q "BEGIN:test-marker" "$wt/regenerated.md"
  [ -d "$wt" ]
}

@test "--yes never removes a merged worktree whose marker file was deleted" {
  # A deletion IS a diff from HEAD, not "no diff" — must not be mistaken for
  # the vacuous "no file on either side" case the predicate also returns
  # true for.
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-file-deleted >/dev/null

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "uncommitted changes"
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  [ ! -f "$wt/regenerated.md" ]
}

@test "--auto never removes a merged worktree whose marker file was deleted" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-file-deleted >/dev/null

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "Removed"
  [ -d "$wt" ]
}

@test "--yes reverts an exact marker block and removes the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block >/dev/null

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
}

@test "--yes reverts an exact marker block even when it's staged" {
  # A plain `git diff --quiet` (no HEAD) compares the working tree to the
  # INDEX, so a staged-but-uncommitted block would short-circuit as "clean"
  # without the HEAD-explicit fix — this proves the block still gets
  # detected and actually reverted (index AND working tree) when staged.
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-staged >/dev/null

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "Removing"
  [ ! -d "$wt" ]
}

@test "--auto reverts an exact marker block and removes the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block >/dev/null

  run prune "$REPO" --auto

  assert_success
  assert_output_contains "Removed 1 merged worktree(s)"
  [ ! -d "$wt" ]
}

@test "--yes leaves a real edit in the marker file alone and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-real-edit >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "a real edit, not just the regenerated block" "$wt/regenerated.md"
}

@test "--yes never reverts a real edit hiding on the required blank separator line" {
  # The actual exploit a naive prefix-length check misses: HEAD's own
  # content is completely untouched, but the line that's supposed to be a
  # blank separator right before the begin marker carries a real edit
  # instead. A predicate that only compares `head -n (begin_line-2)`
  # against HEAD never looks at that line at all, so it can't tell "the
  # separator is blank" from "the separator has an edit in it" — this must
  # be caught and the worktree kept.
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-edit-in-separator >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "a real edit hiding on the separator line" "$wt/regenerated.md"
}

@test "--auto never reverts a real edit hiding on the required blank separator line" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-edit-in-separator >/dev/null

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "Removed"
  [ -d "$wt" ]
  grep -q "a real edit hiding on the separator line" "$wt/regenerated.md"
}

@test "--yes never discards a real note appended after the closing marker, and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-then-real-edit >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "my real followup note" "$wt/regenerated.md"
}

@test "--auto never discards a real note appended after the closing marker, and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-then-real-edit >/dev/null

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "Removed"
  [ -d "$wt" ]
  grep -q "my real followup note" "$wt/regenerated.md"
}

@test "a marker entry missing endMarker is silently ignored, not applied" {
  # endMarker is required by the real schema — an entry that omits it must
  # never fall back to "everything from beginMarker to EOF is the block".
  mkdir -p "$REPO/.claude"
  jq -n '{worktree: {autoPruneCruftMarkers: [{path: "regenerated.md", beginMarker: "<!-- BEGIN:test-marker -->"}]}}' \
    >"$REPO/.claude/settings.json"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "BEGIN:test-marker" "$wt/regenerated.md"
}

@test "--yes never reverts the marker file when another file is also dirty, and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-and-dirty >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "BEGIN:test-marker" "$wt/regenerated.md"
}

@test "--auto never reverts the marker file when another file is also dirty, and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-and-dirty >/dev/null

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "Removed"
  [ -d "$wt" ]
  grep -q "BEGIN:test-marker" "$wt/regenerated.md"
}

@test "--yes never reverts the marker file when the branch has an unpushed commit, and keeps the worktree" {
  configure_cruft_marker regenerated.md "<!-- BEGIN:test-marker -->" "<!-- END:test-marker -->"
  local wt="$REPO/.claude/worktrees/done"
  add_worktree done merged-marker-block-no-upstream >/dev/null

  run prune "$REPO" --yes

  assert_success
  refute_output_contains "Removing $wt"
  [ -d "$wt" ]
  grep -q "BEGIN:test-marker" "$wt/regenerated.md"
}

# --- orphaned-directory sweep ------------------------------------------------
# A directory under .claude/worktrees/ that git's own worktree list doesn't
# know about at all — e.g. a worktree-creation call that mkdir'd it but never
# finished `git worktree add`. Distinct failure mode from a merged-but-kept
# worktree; swept only when it's both old enough (past the grace period, so a
# concurrent session's still-in-progress worktree-creation call is never
# caught by an unlucky-timing SessionStart sweep) and holds no file or
# symlink anywhere in its tree, and only under --yes/--auto. Every "should be
# swept" fixture below is explicitly aged past ORPHAN_GRACE_SECONDS; a fresh
# one is covered separately by the grace-period tests.

@test "a dry run reports an orphaned empty directory but never removes it" {
  local d
  d="$(add_orphaned_dir stray)"
  age_dir "$d" 700

  run prune "$REPO"

  assert_success
  [ -d "$d" ]
}

@test "--yes removes an empty orphaned directory git doesn't know about" {
  local d
  d="$(add_orphaned_dir stray)"
  age_dir "$d" 700

  run prune "$REPO" --yes

  assert_success
  assert_output_contains "not a registered worktree"
  [ ! -d "$d" ]
}

@test "--auto removes an empty orphaned directory git doesn't know about" {
  local d
  d="$(add_orphaned_dir stray)"
  age_dir "$d" 700

  run prune "$REPO" --auto

  assert_success
  assert_output_contains "orphaned worktree director"
  [ ! -d "$d" ]
}

@test "--yes leaves a non-empty orphaned directory alone" {
  local d
  d="$(add_orphaned_dir stray populate)"
  age_dir "$d" 700

  run prune "$REPO" --yes

  assert_success
  [ -d "$d" ]
  [ -f "$d/some-file.txt" ]
}

@test "--yes never sweeps a directory younger than the grace period, even if empty" {
  local d
  d="$(add_orphaned_dir stray)"
  # No age_dir call: this directory is as fresh as one a concurrent
  # session's own worktree-creation call could still be in the middle of.

  run prune "$REPO" --yes

  assert_success
  [ -d "$d" ]
}

@test "--auto never sweeps a directory younger than the grace period, even if empty" {
  local d
  d="$(add_orphaned_dir stray)"

  run prune "$REPO" --auto

  assert_success
  refute_output_contains "orphaned worktree director"
  [ -d "$d" ]
}

@test "--yes never sweeps an old directory containing only a symlink" {
  local d
  d="$(add_orphaned_dir stray symlink)"
  age_dir "$d" 700

  run prune "$REPO" --yes

  assert_success
  [ -d "$d" ]
  [ -L "$d/node_modules" ]
}

@test "--yes never sweeps a directory that IS a real (kept) worktree" {
  add_worktree wip unmerged >/dev/null

  run prune "$REPO" --yes

  assert_success
  [ -d "$REPO/.claude/worktrees/wip" ]
}

# --- hermeticity guard ------------------------------------------------------

@test "the sandbox blocks real network tools" {
  run curl https://example.com

  assert_failure
  assert_output_contains "network blocked in tests"
}
