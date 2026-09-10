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

removable_paths=()
removable_branches=()
report_lines=()

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

  local name="${path#"$repo_root"/}"
  if [ "$path" = "$self" ]; then
    report_lines+=("keep    $name — current session")
  elif $locked; then
    report_lines+=("keep    $name — locked (another session is using it)")
  elif ! is_merged "$branch" "$(git -C "$path" rev-parse HEAD 2>/dev/null)"; then
    report_lines+=("keep    $name — no merged PR for $branch")
  elif [ -n "$(git -C "$path" status --porcelain 2>/dev/null)" ]; then
    report_lines+=("keep    $name — uncommitted changes")
  elif [ "$(git -C "$path" rev-list --count '@{u}..HEAD' 2>/dev/null || echo -1)" != "0" ]; then
    report_lines+=("keep    $name — unpushed commits (or no upstream)")
  else
    removable_paths+=("$path")
    removable_branches+=("$branch")
    report_lines+=("REMOVE  $name — $branch merged")
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
