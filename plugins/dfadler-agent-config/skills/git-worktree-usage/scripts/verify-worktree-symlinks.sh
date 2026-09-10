#!/usr/bin/env bash
set -uo pipefail

# Verify that every directory a project symlinks into its worktrees (per
# .claude/settings.json's worktree.symlinkDirectories, e.g. a heavy
# node_modules or vendor directory) actually resolves back to the MAIN
# checkout, and optionally repair it.
#
# `worktree.symlinkDirectories` is NOT a Claude Code setting — EnterWorktree
# and `--worktree` only ever check out tracked files, so a fresh worktree
# never gets a heavy untracked directory for free. A project that wants to
# share one copy of such a directory across every worktree (instead of each
# worktree reinstalling its own) has to create that symlink itself — e.g. a
# post-creation step, a WorktreeCreate hook, or a one-off "materialize"
# script — and `worktree.symlinkDirectories` is just where this script (and
# its companion SessionStart hook) look to find out which directories that
# project has taken on the convention for. This script only ever verifies
# and repairs; it never originates a symlink that doesn't already exist.
#
# Why this exists: whatever creates these symlinks can race under heavy
# parallel worktree creation — one adopting project hit two independently
# spawned worktrees each resolving to a DIFFERENT (in one case already
# deleted) sibling worktree instead of the main checkout, which silently
# broke every command that reads through the symlink until someone noticed
# and re-ran the materialize step by hand. Running this script in --fix mode
# on every session start catches a bad link immediately instead of letting
# it surface later as a confusing, hard-to-place failure.
#
# What it does NOT do: touch a directory that isn't a symlink at all. A
# worktree whose copy of a symlinkDirectories entry has already been
# materialized into a real, independent directory is left alone.
#
# Usage:
#   verify-worktree-symlinks.sh          # check only; reports mismatches
#   verify-worktree-symlinks.sh --fix    # also repair any mismatch found
#
# Exit codes: 0 all symlinks verified (or nothing to check), 1 a mismatch was
# found and not fixed, 2 bad usage, 4 a required dependency (jq) is missing.

EXIT_OK=0
EXIT_FAILURE=1
EXIT_USAGE=2
EXIT_DEPENDENCY=4

usage() {
  cat <<'EOF'
Usage: verify-worktree-symlinks.sh [-h|--help] [--fix]

Checks every directory named in .claude/settings.json's
worktree.symlinkDirectories: if it's a symlink in THIS worktree, confirms it
resolves to the main checkout's copy of that directory. Prints a mismatch
(wrong target, or a target that no longer exists) to stderr.

  --fix   Repair a mismatched symlink by relinking it to the main checkout.
          Never touches a directory that isn't a symlink (e.g. one already
          materialized into a real, independent copy).

No-op (exit 0) when run from the main checkout, or when
symlinkDirectories is empty/unset.
EOF
}

fix=false
for arg in "$@"; do
  case "$arg" in
    -h | --help)
      usage
      exit "$EXIT_OK"
      ;;
    --fix)
      fix=true
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit "$EXIT_USAGE"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required but not found on PATH." >&2
  exit "$EXIT_DEPENDENCY"
fi

self="$(git rev-parse --show-toplevel)"
# Same main-vs-worktree detection as elsewhere in this project: in a linked
# worktree, --git-dir points at .git/worktrees/<name> while --git-common-dir
# points at the main checkout's .git; in the main checkout the two match.
git_dir="$(cd "$(git rev-parse --git-dir)" && pwd)"
common_dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)"

if [[ "$git_dir" == "$common_dir" ]]; then
  # Main checkout: nothing symlinks FROM it, so there's nothing to verify.
  exit "$EXIT_OK"
fi

main_checkout="$(dirname "$common_dir")"

settings_file="$self/.claude/settings.json"
if [[ ! -f "$settings_file" ]]; then
  exit "$EXIT_OK"
fi

# Avoid `mapfile`/`readarray` (bash 4+ only): macOS still ships bash 3.2 as
# the default `bash` on PATH, and this script needs to run there too.
dirs=()
while IFS= read -r dir; do
  [[ -n "$dir" ]] && dirs+=("$dir")
done < <(jq -r '.worktree.symlinkDirectories[]? // empty' "$settings_file" 2>/dev/null)

if [[ ${#dirs[@]} -eq 0 ]]; then
  exit "$EXIT_OK"
fi

# A per-iteration scalar (rather than this flag, accumulated once true and
# never reset) would let a LATER entry's successful --fix erase an EARLIER
# entry's still-unresolved failure — dormant when symlinkDirectories lists
# only one entry, but the loop is written to support more.
any_unresolved=false

for dir in "${dirs[@]}"; do
  path="$self/$dir"
  main_path="$main_checkout/$dir"

  # Not a symlink here (missing, or already a real/materialized directory) —
  # nothing for this check to do.
  [[ -L "$path" ]] || continue

  if [[ ! -d "$main_path" ]]; then
    echo "verify-worktree-symlinks: $dir is a symlink but the main checkout" >&2
    echo "  has no $dir to point at ($main_path missing) — leaving as-is." >&2
    any_unresolved=true
    continue
  fi
  main_resolved="$(cd "$main_path" && pwd -P)"

  # Resolve the symlink's actual target by cd-ing through it (works for both
  # relative and absolute symlink targets, no GNU realpath dependency).
  if ! target_resolved="$(cd "$path" 2>/dev/null && pwd -P)"; then
    echo "verify-worktree-symlinks: $dir is a broken symlink ($(readlink "$path"))." >&2
    if $fix; then
      if rm "$path" && ln -s "$main_path" "$path"; then
        echo "verify-worktree-symlinks: relinked $dir -> $main_path" >&2
      else
        echo "verify-worktree-symlinks: failed to relink $dir" >&2
        any_unresolved=true
      fi
    else
      any_unresolved=true
    fi
    continue
  fi

  if [[ "$target_resolved" != "$main_resolved" ]]; then
    echo "verify-worktree-symlinks: $dir resolves to $target_resolved," >&2
    echo "  not the main checkout ($main_resolved)." >&2
    if $fix; then
      if rm "$path" && ln -s "$main_path" "$path"; then
        echo "verify-worktree-symlinks: relinked $dir -> $main_path" >&2
      else
        echo "verify-worktree-symlinks: failed to relink $dir" >&2
        any_unresolved=true
      fi
    else
      any_unresolved=true
    fi
  fi
done

if $any_unresolved; then
  exit "$EXIT_FAILURE"
fi
exit "$EXIT_OK"
