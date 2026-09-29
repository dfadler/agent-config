#!/usr/bin/env bash
set -uo pipefail

# Remove local git worktrees whose pull request has already been MERGED, and
# leave everything else untouched. Companion to Claude Code's worktrees under
# .claude/worktrees/, whether created by EnterWorktree/--worktree on a
# `worktree-*` branch or by the desktop app on an auto-generated `claude/*`
# branch (e.g. claude/competent-fermi-33e7a1). Claude Code's own periodic
# stale-worktree sweep only ever looks at local git state (age, lock status,
# clean/pushed) — it has no way to know a PR merged, so a merged worktree from
# an ordinary interactive session (never backgrounded, so outside that
# sweep's scope) otherwise lingers under .claude/worktrees/ forever unless
# something checks GitHub. This script is that check.
#
# Scope & safety - a worktree is only ever removed when ALL of these hold:
#   * its path is under .claude/worktrees/ AND its branch matches `worktree-*`
#     or `claude/*` (so hand-made worktrees/branches and the main checkout are
#     never touched)
#   * it is NOT locked - Claude Code locks a worktree while a session is using
#     it, so a lock means "another session is in here"; we skip it
#   * it is NOT the worktree this script is being run from
#   * its working tree is clean (no uncommitted changes) AND has no commits that
#     aren't pushed to its upstream
#   * a MERGED pull request exists for its branch, at the SAME commit the
#     worktree is currently at — not just a branch-name match
# Anything that fails a check is reported and LEFT in place. Never uses --force.
#
# Merged detection asks GitHub via `gh` (one `gh pr list --state merged` call,
# matched by head branch) rather than `git branch --merged`: the latter is wrong
# for squash/rebase merges (the branch tip never lands on main) and it keeps
# working after the remote head branch is auto-deleted on merge.
#
# Branch name alone isn't a safe match: `gh pr list --state merged` keeps
# returning an OLD PR's record forever, even after its branch name is reused
# by a new, unrelated, still-open PR — a fact about a past PR, not about what
# the branch currently points at. So merge matching also requires the
# worktree's own current commit (`git rev-parse HEAD`) to equal that merged
# PR's recorded head commit (`headRefOid`); a same-named branch sitting at a
# different commit is correctly kept as "no merged PR for <branch>".
#
# Remote branches are intentionally NOT deleted here - turn on GitHub's
# "Automatically delete head branches" for that. This is local-only cleanup.
#
# A worktree branch that was never individually pushed (no @{u} at all — an
# EnterWorktree/desktop-app branch name is often not the branch a PR actually
# opened from) falls back to checking whether its HEAD is already an ancestor
# of the project's main branch: if so it carries no unique content either, and
# is just as removable as one that's pushed with 0 commits ahead.
#
# A directory under .claude/worktrees/ that git's own `worktree list` doesn't
# know about at all — wreckage from a worktree-creation call that made the
# directory but never completed `git worktree add` — is swept separately,
# removed only when it holds zero files anywhere in its tree.
#
# A project may declare, in its own .claude/settings.json, tracked files whose
# diff is safe to revert before the clean check IF AND ONLY IF the entire diff
# is exactly an appended marker-delimited block (some tooling — e.g. `next
# dev` — regenerates such a block on every run):
#   { "worktree": { "autoPruneCruftMarkers": [
#     { "path": "CLAUDE.md", "beginMarker": "<!-- BEGIN:some-marker -->",
#       "endMarker": "<!-- END:some-marker -->" }
#   ] } }
# endMarker is required, not optional: an entry missing it is silently
# ignored (a no-op, not an error) rather than falling back to "everything
# from beginMarker to EOF is the block" — that fallback couldn't tell real
# content appended after the true end of the block apart from the block
# itself, and the revert discards the whole file, not just a region.
# The revert only ever fires once every OTHER condition for REMOVE already
# holds (everything else clean, the branch carries no unique content) — never
# on a worktree that's being kept for an unrelated reason. Any other
# difference anywhere in a configured file (a real edit mixed in) leaves it
# untouched, so genuine work is never mistaken for regenerated cruft.
#
# Usage:
#   prune-merged-worktrees.sh              # dry run: report only, remove nothing
#   prune-merged-worktrees.sh --yes         # actually remove the merged worktrees
#   prune-merged-worktrees.sh --hook   # quiet unless something is removable
#                                       # (read-only nudge); never removes anything
#   prune-merged-worktrees.sh --auto   # quiet auto-remove for the SessionStart
#                                       # hook: removes the merged set, prints a
#                                       # one-line summary, never fails the session

apply=false
hook_mode=false
auto_mode=false
for arg in "$@"; do
  case "$arg" in
    -y | --yes) apply=true ;;
    --hook) hook_mode=true ;;
    --auto)
      # Auto-remove, but keep the hook's quiet/non-fatal behavior (always exit 0,
      # silent on gh/network errors, local-only).
      auto_mode=true
      hook_mode=true
      ;;
    -h | --help)
      # Print only the leading comment block (the header above), not every
      # `#`-prefixed line in the file — stop at the first blank line once the
      # header has started, so body comments never leak into --help output.
      awk 'NR==1{next} /^#/{print; started=1; next} started{exit}' "$0" | sed -E 's/^# ?//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done
# Resolve whether we actually remove:
#   --auto → remove (quietly);  --hook alone → read-only nudge, never remove.
# So `--hook --yes` still stays a dry run — only --auto flips the hook to acting.
if $auto_mode; then
  apply=true
elif $hook_mode; then
  apply=false
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  $hook_mode && exit 0
  echo "Not inside a git repository." >&2
  exit 1
fi

self="$(git rev-parse --show-toplevel)"
# --git-common-dir is the MAIN checkout's .git even when run from a linked
# worktree, so repo_root (and the worktree listing below) is the same no matter
# which worktree invoked us.
repo_root="$(cd "$(git rev-parse --git-common-dir)/.." && pwd)"
wt_prefix="$repo_root/.claude/worktrees/"

# gh must be present AND authenticated to know merge status. Missing/unauthed is
# a silent no-op for the hook, but a clear error when a human ran the command.
if ! command -v gh >/dev/null 2>&1 || ! gh auth status >/dev/null 2>&1; then
  $hook_mode && exit 0
  echo "This needs the GitHub CLI, authenticated: install 'gh' and run 'gh auth login'." >&2
  exit 1
fi

# One API call: every merged PR's head branch name AND head commit SHA.
# Membership check is local. Fail CLOSED if the call itself errors (network,
# rate limit, API 5xx) — an empty result then would be indistinguishable from
# "nothing merged" and every worktree would be misreported as unmerged. Abort
# loudly for a human; stay silent for the hook. (An empty list on success is
# exit 0 and handled normally.)
if ! merged_heads="$(gh pr list --state merged --limit 500 \
  --json headRefName,headRefOid --jq '.[] | [.headRefName, .headRefOid] | @tsv' 2>/dev/null)"; then
  $hook_mode && exit 0
  echo "Couldn't fetch merged PRs from GitHub (network or API error). Aborting without changes." >&2
  exit 1
fi
# Matching branch name alone isn't enough: a branch name can be reused after
# its earlier PR merged (a new, unrelated, still-open PR on the same name),
# and `gh pr list --state merged` still returns that earlier PR's record
# forever — it's a fact about a past PR, not about what the branch currently
# points at. Requiring the worktree's OWN current commit to equal the merged
# PR's recorded head commit is what tells "this exact merged work" apart from
# "a same-named but unrelated branch that happens to still be clean and
# pushed" — the second only ever looks removable if this check is skipped.
is_merged() {
  local branch="$1" head_oid="$2" candidate_branch candidate_oid
  while IFS=$'\t' read -r candidate_branch candidate_oid; do
    [ "$candidate_branch" = "$branch" ] && [ "$candidate_oid" = "$head_oid" ] && return 0
  done <<<"$merged_heads"
  return 1
}

# Deliberately NO `git fetch --prune` here. The merged signal comes live from
# `gh pr list` above, so a fetch adds nothing to the merge decision — but it
# WOULD break the "unpushed commits" check below. A repo with GitHub's
# "Automatically delete head branches" on has already lost the origin branch for
# a merged worktree by the time this runs; the only thing keeping @{u} resolvable
# is the still-present local remote-tracking ref. `fetch --prune` would delete
# that ref, `@{u}` would stop resolving, and every merged-and-pushed worktree
# would be mis-kept as "unpushed (no upstream)" — i.e. auto-remove would never
# remove anything. A stale ref (upstream tip behind HEAD) only ever errs toward
# keeping, which is the safe direction, so leaving it un-pruned costs nothing.

# Ref to fall back on when a worktree's branch has no upstream at all (see
# _pushed_or_already_on_main below). Prefers a local `main`, falls back to
# `origin/main`. Left empty (fallback skipped, erring toward keep) if neither
# resolves — e.g. a repo whose default branch isn't named "main" at all.
main_ref=""
if git rev-parse --verify --quiet main >/dev/null; then
  main_ref="main"
elif git rev-parse --verify --quiet origin/main >/dev/null; then
  main_ref="origin/main"
fi

# True if a worktree's HEAD carries nothing beyond what's already pushed. A
# resolvable @{u} with 0 commits ahead is the normal case. A branch that was
# never individually pushed (no @{u} at all) falls back to asking whether
# HEAD is already an ancestor of $main_ref: if so it has no unique content
# either, regardless of never having had an upstream. Errs toward false
# (keep) when neither check resolves.
_pushed_or_already_on_main() {
  local path="$1" ahead
  if git -C "$path" rev-parse --verify --quiet '@{u}' >/dev/null 2>&1; then
    ahead="$(git -C "$path" rev-list --count '@{u}..HEAD' 2>/dev/null || echo -1)"
    [ "$ahead" = "0" ]
    return
  fi
  [ -n "$main_ref" ] || return 1
  git -C "$path" merge-base --is-ancestor HEAD "$main_ref" 2>/dev/null
}

# Reads a project's opt-in worktree.autoPruneCruftMarkers config (see the
# script header) from the MAIN checkout's .claude/settings.json — not
# whichever worktree the script happens to be invoked from, and not the
# CANDIDATE worktree being classified, either of which could be sitting on an
# old branch that predates the config, or simply differ from the policy the
# project currently wants applied uniformly. Emits "path<TAB>beginMarker<TAB>
# endMarker" lines; empty (no markers) when jq is missing, the file is
# absent, the key is unset, or an entry omits endMarker (see
# file_diff_is_only_marker_block for why that field is required, not
# optional) — this whole mechanism is a no-op for every project that hasn't
# opted in.
read_cruft_markers() {
  local settings="$repo_root/.claude/settings.json"
  command -v jq >/dev/null 2>&1 || return 0
  [ -f "$settings" ] || return 0
  jq -r '.worktree.autoPruneCruftMarkers // [] | .[] | select(.endMarker != null and .endMarker != "") | [.path, .beginMarker, .endMarker] | @tsv' \
    "$settings" 2>/dev/null
}
cruft_markers="$(read_cruft_markers)"

# True (no mutation) when a configured tracked file has no diff from HEAD at
# all, or its ENTIRE diff is exactly the appended marker-delimited block —
# from the begin marker's own line through the end marker's own line, plus
# the one blank line the block is always appended after. False for any other
# difference anywhere in the file, BEFORE the block (a real edit mixed in)
# OR AFTER it (real content appended past the closing marker — a very
# natural place to add a note, since the block sits at the bottom of the
# file), so genuine work is never mistaken for cruft. Checking only the
# prefix before the begin marker isn't enough on its own: the caller's
# revert discards the ENTIRE file back to HEAD, so anything genuine sitting
# after the end marker would be silently destroyed right along with the
# block unless this predicate also confirms nothing real follows it — which
# is why endMarker is a required part of the config, not optional: without
# a defined end boundary there's no way to tell "just the block" from "the
# block, plus more". A pure predicate — callers decide whether reverting is
# actually safe (see flush()) BEFORE calling revert_cruft_markers.
#
# Pure text predicate — no git, no worktree, no reference to anything but
# FILE itself. Locates the marker-delimited block's outermost span: the
# line containing the FIRST occurrence of BEGIN_MARKER through the line
# containing the LAST occurrence of END_MARKER at or after it. On success,
# prints "<begin_line>\t<end_line>" (1-indexed) and returns 0; prints
# nothing and returns 1 if BEGIN_MARKER isn't present at all, or if no
# END_MARKER is found at or after wherever BEGIN_MARKER is (a malformed or
# unclosed block — this also guards against END_MARKER's text coincidentally
# appearing earlier in the file, before BEGIN_MARKER, which would otherwise
# compute a nonsensical negative-length span).
#
# Deliberately the whole reason file_diff_is_only_marker_block below is
# split in two: this half is directly unit-testable against a plain temp
# file, with none of the git/worktree/gh-shim integration machinery the
# other half needs — see scripts/tests/prune-merged-worktrees.bats's
# "marker_block_bounds" tests for exactly that.
marker_block_bounds() {
  local file="$1" begin_marker="$2" end_marker="$3" begin_line end_line
  begin_line="$(grep -Fn -- "$begin_marker" "$file" 2>/dev/null | head -1 | cut -d: -f1)"
  [ -n "$begin_line" ] || return 1
  end_line="$(grep -Fn -- "$end_marker" "$file" 2>/dev/null | tail -1 | cut -d: -f1)"
  [ -n "$end_line" ] && [ "$end_line" -ge "$begin_line" ] || return 1
  printf '%s\t%s\n' "$begin_line" "$end_line"
}

# The git-coupled half: is REL_FILE's entire diff from HEAD, inside worktree
# PATH, nothing but the block marker_block_bounds locates plus the one
# blank separator line it's always appended after? False for any other
# difference anywhere in the file, BEFORE the block (a real edit mixed in)
# OR AFTER it (real content appended past the closing marker — a very
# natural place to add a note, since the block sits at the bottom of the
# file), so genuine work is never mistaken for cruft. A pure predicate
# (beyond the git reads themselves) — callers decide whether reverting is
# actually safe (see flush()) BEFORE calling revert_cruft_markers.
#
# The checks below do two things a naive `head -n | string-compare` can't:
# independently confirm the line immediately before the begin marker is the
# single blank separator (not just trusting "whatever's there must be it"),
# and confirm HEAD's own line count via `git show | wc -l` rather than only
# a string comparison. Without the first, a real edit could hide in exactly
# that slot — sitting past HEAD's own last line, before the begin marker,
# invisible to the prefix/HEAD comparison since that comparison never looks
# at that one line at all. Without the second, command substitution
# stripping ALL trailing newlines from both sides of the string comparison
# could mask a HEAD-ends-in-blank-line(s) vs. prefix-missing-them mismatch
# that a pure string compare wouldn't catch on its own.
file_diff_is_only_marker_block() {
  local path="$1" rel_file="$2" begin_marker="$3" end_marker="$4"
  local file bounds begin_line end_line stripped trailing head_version head_line_count
  file="$path/$rel_file"
  # No `[ -f "$file" ] || return 0` short-circuit here on purpose: a missing
  # working-tree file IS a diff from HEAD (a deletion) whenever HEAD has the
  # file, not "no diff" — the check below already handles both the genuine
  # no-file-either-side case (exits 0, correctly "safe") and the
  # deleted-but-tracked-at-HEAD case (exits nonzero, correctly falls through
  # to the marker check, which fails closed since $file doesn't exist).
  #
  # Compares against HEAD explicitly, not a bare `diff --quiet` (which only
  # compares the working tree to the INDEX): a staged-but-uncommitted change
  # would otherwise short-circuit here as "no diff", misreporting a real
  # diff from HEAD as clean.
  git -C "$path" diff --quiet HEAD -- "$rel_file" 2>/dev/null && return 0
  bounds="$(marker_block_bounds "$file" "$begin_marker" "$end_marker")" || return 1
  begin_line="${bounds%%$'\t'*}"
  end_line="${bounds##*$'\t'}"
  [ "$begin_line" -ge 2 ] || return 1
  trailing="$(tail -n +"$((end_line + 1))" "$file")"
  [ -z "$trailing" ] || return 1
  [ -z "$(sed -n "$((begin_line - 1))p" "$file")" ] || return 1
  head_version="$(git -C "$path" show "HEAD:$rel_file" 2>/dev/null)" || return 1
  head_line_count="$(git -C "$path" show "HEAD:$rel_file" 2>/dev/null | wc -l | tr -d ' ')"
  [ "$head_line_count" = "$((begin_line - 2))" ] || return 1
  stripped="$(head -n "$((begin_line - 2))" "$file")"
  [ "$stripped" = "$head_version" ]
}

# True only when EVERY configured marker file independently passes
# file_diff_is_only_marker_block. Vacuously true when no markers are
# configured — the mechanism is then simply inert.
all_cruft_markers_safe() {
  local path="$1" rel_file begin_marker end_marker
  while IFS=$'\t' read -r rel_file begin_marker end_marker; do
    [ -n "$rel_file" ] || continue
    file_diff_is_only_marker_block "$path" "$rel_file" "$begin_marker" "$end_marker" || return 1
  done <<<"$cruft_markers"
  return 0
}

# Reverts every configured marker file to HEAD's version. Callers must only
# invoke this once all_cruft_markers_safe AND every other REMOVE condition
# already hold (see flush()) — it re-checks cheaply per file too, so calling
# it when a file has nothing to revert is a no-op, but it does NOT know
# whether the worktree as a whole is otherwise clean.
revert_cruft_markers() {
  local path="$1" rel_file begin_marker end_marker
  while IFS=$'\t' read -r rel_file begin_marker end_marker; do
    [ -n "$rel_file" ] || continue
    [ -f "$path/$rel_file" ] || continue
    git -C "$path" diff --quiet HEAD -- "$rel_file" 2>/dev/null && continue
    # Explicit HEAD, not a bare `checkout -- <path>`: the latter restores
    # from the INDEX, which for a staged-but-uncommitted block is already
    # the modified content — a no-op that would leave the file dirty
    # relative to HEAD. `checkout HEAD -- <path>` updates both the index
    # and the working tree, actually reverting a staged change too.
    git -C "$path" checkout HEAD -- "$rel_file"
  done <<<"$cruft_markers"
}

# The pathspec that excludes every configured marker file from a "does
# anything ELSE need to stay dirty" status check — built once since
# cruft_markers doesn't change during a run.
cruft_marker_exclude_pathspecs=()
while IFS=$'\t' read -r _cm_path _cm_begin _cm_end; do
  [ -n "$_cm_path" ] && cruft_marker_exclude_pathspecs+=(":!$_cm_path")
done <<<"$cruft_markers"

removable_paths=()
removable_branches=()
report_lines=()

# --- classify_worktree and its rules -----------------------------------------
#
# Fixes a real bug: flush() used to have two DIFFERENT decision paths — one
# reached only when $apply was true (which also checked cruft-marker safety),
# and a separate dry-run fallback that never checked markers at all. A dry
# run could report "keep — uncommitted changes" for a worktree that --yes
# would actually remove, because the two paths silently disagreed. Every
# KEEP_RULES entry below is apply-blind BY CONSTRUCTION — $apply isn't even
# passed to a rule — so classify_worktree computes the exact same REMOVE/KEEP
# decision regardless of mode; only whether the decision gets ACTED on
# (ON_REMOVE_HOOKS, below) depends on $apply. This is an internal seam:
# flush() only ever calls classify_worktree, never a rule directly.
#
# Rule contract — a rule is `rule_<name> PATH BRANCH LOCKED`:
#   exit 0, no stdout  → this worktree passes; try the next rule.
#   exit 1, reason on stdout → KEEP, for exactly this reason.
# Evaluated in array order, which IS the safety-ordering guarantee: cheap
# same-worktree-identity checks (self/locked) before the GitHub-derived merge
# check, before anything that touches the configured marker files.
rule_self() {
  [ "$1" = "$self" ] || return 0
  printf 'current session\n'
  return 1
}

rule_locked() {
  "$3" || return 0
  printf 'locked (another session is using it)\n'
  return 1
}

rule_merged() {
  is_merged "$2" "$(git -C "$1" rev-parse HEAD 2>/dev/null)" && return 0
  printf 'no merged PR for %s\n' "$2"
  return 1
}

# Folds in all_cruft_markers_safe (non-mutating) rather than calling
# revert_cruft_markers itself — mutation is ON_REMOVE_HOOKS's job, run only
# once classify_worktree has already returned REMOVE.
rule_clean() {
  local path="$1"
  if [ -z "$(git -C "$path" status --porcelain -- . "${cruft_marker_exclude_pathspecs[@]+"${cruft_marker_exclude_pathspecs[@]}"}" 2>/dev/null)" ] &&
    all_cruft_markers_safe "$path"; then
    return 0
  fi
  printf 'uncommitted changes\n'
  return 1
}

rule_pushed_or_main() {
  _pushed_or_already_on_main "$1" && return 0
  printf 'unpushed commits (or no upstream)\n'
  return 1
}

KEEP_RULES=(rule_self rule_locked rule_merged rule_clean rule_pushed_or_main)

# Runs only once classify_worktree has independently returned REMOVE, and
# only when $apply is true — never as part of a rule's own decision. Reverts
# every configured marker file; the worktree-removal loop (remove_removable)
# runs separately afterward.
ON_REMOVE_HOOKS=(revert_cruft_markers)

# classify_worktree PATH BRANCH LOCKED
#   Pure, read-only, apply-blind. Prints exactly one line to stdout:
#   "REMOVE\t$branch merged" or "KEEP\t<reason>". Callers split on the tab.
classify_worktree() {
  local path="$1" branch="$2" locked="$3"
  local rule reason status
  for rule in "${KEEP_RULES[@]}"; do
    reason="$("$rule" "$path" "$branch" "$locked")"
    status=$?
    [ "$status" -eq 0 ] && continue
    printf 'KEEP\t%s\n' "$reason"
    return 0
  done
  printf 'REMOVE\t%s merged\n' "$branch"
}

# Classify one worktree record parsed from `git worktree list --porcelain`.
path=""
branch=""
locked=false
flush() {
  [ -n "$path" ] || return 0
  # Only Claude-created worktrees are in scope: those under .claude/worktrees/
  # on either a `worktree-*` branch (EnterWorktree/--worktree) or a `claude/*`
  # branch (the desktop app's auto-generated sessions). Everything else — hand-
  # made worktrees/branches and the main checkout — is left untouched.
  case "$path" in "$wt_prefix"*) ;; *)
    path=""
    branch=""
    locked=false
    return 0
    ;;
  esac
  case "$branch" in worktree-* | claude/*) ;; *)
    path=""
    branch=""
    locked=false
    return 0
    ;;
  esac

  local name="${path#"$repo_root"/}" decision reason
  IFS=$'\t' read -r decision reason < <(classify_worktree "$path" "$branch" "$locked")
  if [ "$decision" = "REMOVE" ]; then
    if $apply; then
      # Every REMOVE condition already holds — mutating the configured
      # marker files here can only ever complete a removal that was already
      # going to happen, never touch a worktree we're about to keep.
      local hook
      for hook in "${ON_REMOVE_HOOKS[@]}"; do "$hook" "$path"; done
    fi
    removable_paths+=("$path")
    removable_branches+=("$branch")
    report_lines+=("REMOVE  $name — $reason")
  else
    report_lines+=("keep    $name — $reason")
  fi
  path=""
  branch=""
  locked=false
}

while IFS= read -r line; do
  case "$line" in
    "worktree "*) path="${line#worktree }" ;;
    "branch refs/heads/"*) branch="${line#branch refs/heads/}" ;;
    "locked"*) locked=true ;;
    "") flush ;;
  esac
done < <(
  git worktree list --porcelain
  printf '\n'
)
flush

# Every path git still considers a worktree, in or out of scope — used by
# sweep_orphaned_dirs below to tell "a real worktree flush() chose to skip"
# from "wreckage git doesn't even know about anymore".
all_worktree_paths="$(git worktree list --porcelain | sed -n 's/^worktree //p')"

# Remove every worktree the classification above marked removable, and delete
# its local branch. This acts ONLY on removable_paths — the safety envelope
# (scope/locked/self/merged/clean/pushed) was already decided in flush(), so
# this loop adds no new judgement, just the mechanical removal. Records the
# branches actually removed in `removed_branches`. `verbose` (true|false)
# controls per-item chatter: the human path narrates every step; the auto hook
# stays quiet and reports a one-line summary of its own.
removed_branches=()
remove_removable() {
  local verbose="$1" i p b
  for i in "${!removable_paths[@]}"; do
    p="${removable_paths[$i]}"
    b="${removable_branches[$i]}"
    $verbose && echo "==> Removing $p ($b)"
    if git worktree remove "$p" 2>/dev/null; then
      git branch -D "$b" >/dev/null 2>&1 || true
      removed_branches+=("$b")
    elif $verbose; then
      echo "    Could not remove $p — left in place." >&2
    fi
  done
  git worktree prune 2>/dev/null || true
}

# Directories younger than this are never swept, no matter how empty —
# indistinguishable from one a concurrent session's own worktree-creation
# call is still in the middle of creating (projects using this hook
# routinely run several sessions at once, each in its own worktree). A
# worktree-creation call normally completes in well under a minute even on a
# slow machine, so this is generous headroom, not a meaningful delay for
# genuinely abandoned wreckage — it just gets swept on a later session start
# instead of this one.
ORPHAN_GRACE_SECONDS=600

# Portable mtime-in-epoch-seconds. Order matters here, and isn't arbitrary:
# GNU stat's `-c FORMAT` fails cleanly (exit 1, "illegal option") on BSD
# stat, but the reverse doesn't hold — GNU's `-f` means "filesystem status"
# (a bare flag, not "format", unlike BSD), so `stat -f %m` on GNU parses `%m`
# as a second, nonexistent FILE argument rather than erroring, and still
# exits 0 with unrelated multi-line output. A `||` fallback only works when
# the first branch fails loudly on the platform it doesn't belong to — GNU
# form first is the one direction that's actually safe both ways.
_dir_mtime_epoch() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null
}

# Sweep .claude/worktrees/ for directories git no longer even considers a
# worktree — e.g. a worktree-creation call that made the directory but never
# completed `git worktree add`, leaving inert wreckage indistinguishable by
# name alone from a real worktree. Removed ONLY when the directory is older
# than $ORPHAN_GRACE_SECONDS (see above) AND holds nothing but empty
# subdirectories anywhere in its tree — no regular file, no symlink (a
# worktree can get a symlinked directory very early in its setup, before
# `git worktree add` has written anything else; `find`'s default `-type f`
# doesn't match a symlink at all, so checking for "no directory entries"
# rather than "no files" is what actually catches that case). Anything with
# real content, or too young to judge, is left for a human — or a later
# sweep — to look at. `known` is $all_worktree_paths — anything git still
# lists, in or out of flush()'s scope, is never touched here.
removed_orphans=()
sweep_orphaned_dirs() {
  local known="$1" verbose="$2" d mtime now
  [ -d "$wt_prefix" ] || return 0
  now="$(date +%s)"
  for d in "$wt_prefix"*/; do
    d="${d%/}"
    [ -d "$d" ] || continue
    printf '%s\n' "$known" | grep -Fxq -- "$d" && continue
    mtime="$(_dir_mtime_epoch "$d")" || continue
    [ -n "$mtime" ] || continue
    [ "$((now - mtime))" -lt "$ORPHAN_GRACE_SECONDS" ] && continue
    [ -n "$(find "$d" -mindepth 1 ! -type d -print -quit 2>/dev/null)" ] && continue
    rm -rf -- "$d"
    removed_orphans+=("${d#"$repo_root"/}")
    $verbose && echo "==> Removing $d (empty, not a registered worktree)"
  done
}

# --- SessionStart auto-remove (quiet, non-fatal, always exits 0) -------------
if $auto_mode; then
  if [ "${#removable_paths[@]}" -gt 0 ]; then
    remove_removable false
    if [ "${#removed_branches[@]}" -gt 0 ]; then
      echo "🧹 Removed ${#removed_branches[@]} merged worktree(s):"
      for b in "${removed_branches[@]}"; do
        echo "   • $b"
      done
    fi
  else
    git worktree prune 2>/dev/null || true
  fi
  sweep_orphaned_dirs "$all_worktree_paths" false
  if [ "${#removed_orphans[@]}" -gt 0 ]; then
    echo "🧹 Removed ${#removed_orphans[@]} orphaned worktree director(ies):"
    for d in "${removed_orphans[@]}"; do
      echo "   • $d"
    done
  fi
  exit 0
fi

# --- read-only nudge (report what could be removed, remove nothing) ---------
if $hook_mode; then
  if [ "${#removable_paths[@]}" -gt 0 ]; then
    echo "🧹 ${#removable_paths[@]} merged worktree(s) can be cleaned up:"
    for i in "${!removable_paths[@]}"; do
      echo "   • ${removable_branches[$i]}"
    done
    echo "   Remove them with: $0 --yes"
  fi
  exit 0
fi

# --- human run (dry-run report, or --yes removal) ----------------------------
# Orphaned-directory sweep runs here (once, regardless of which exit path
# below fires) rather than inline in each branch — same $apply guard as
# everywhere else: only --yes mutates, a plain dry run reports and stops.
$apply && sweep_orphaned_dirs "$all_worktree_paths" true

if [ "${#report_lines[@]}" -eq 0 ]; then
  echo "No Claude worktrees found under .claude/worktrees/."
  git worktree prune
  exit 0
fi

printf '%s\n' "${report_lines[@]}"
echo

if [ "${#removable_paths[@]}" -eq 0 ]; then
  echo "Nothing to remove."
  git worktree prune
  exit 0
fi

if ! $apply; then
  echo "Dry run: ${#removable_paths[@]} worktree(s) would be removed. Re-run with --yes to remove them."
  exit 0
fi

remove_removable true
echo "Done."
