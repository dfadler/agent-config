#!/usr/bin/env bash
set -uo pipefail

# SessionStart entrypoint: auto-remove any Claude worktree whose PR has already
# merged, so stale worktrees don't pile up under .claude/worktrees/.
#
# Off by default — a project must opt in before this hook does anything.
#
# Auto-prune mode (highest priority first):
#   1. WORKTREE_AUTO_PRUNE env var (session-level override):
#      0/false/no/off → nudge-only; 1/true/yes/on → auto-remove; else → from settings
#   2. worktree.autoPrune in .claude/settings.json (project config):
#      true → auto-remove; false → nudge-only
#   3. Default (neither set): skip entirely — no nudge, no removal.
#
# See prune-merged-worktrees.sh's own header for the full safety envelope.
# Runs ONLY locally — a cloud/remote session has no worktrees to prune.
# Always exits 0; a session start must never be blocked by this cleanup.

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$script_dir/worktree-hook-lib.sh"

# Resolve env-var level (session override).
env_mode=""
case "${WORKTREE_AUTO_PRUNE:-}" in
  0 | false | no | off) env_mode="--hook" ;;
  1 | true | yes | on) env_mode="--auto" ;;
esac

# Resolve final mode. Empty means "not configured" — stays empty (skip) unless
# settings.json explicitly opts in one way or the other.
#
# No `// empty` in the jq expr: jq's `//` treats a literal `false` as falsy,
# which would swallow an explicit autoPrune:false the same as a missing key.
# read_worktree_setting defaults to "null" so we can distinguish null from false.
mode="$env_mode"
if [ -z "$mode" ]; then
  val="$(read_worktree_setting '.worktree.autoPrune' "null")"
  case "$val" in
    true) mode="--auto" ;;
    false) mode="--hook" ;;
  esac
fi

if [ -z "$mode" ]; then
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/prune-merged-worktrees.sh"

if [ -f "$script" ]; then
  bash "$script" "$mode" 2>/dev/null || true
fi
exit 0
