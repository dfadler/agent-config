#!/usr/bin/env bash
set -uo pipefail

# SessionStart entrypoint: auto-remove any Claude worktree whose PR has already
# merged, so stale worktrees don't pile up under .claude/worktrees/.
#
# Auto-prune mode (highest priority first):
#   1. WORKTREE_AUTO_PRUNE env var (session-level override):
#      0/false/no/off → nudge-only; 1/true/yes/on → auto-remove; else → from settings
#   2. worktree.autoPrune in .claude/settings.json (project config):
#      true → auto-remove (default); false → nudge-only
#
# See prune-merged-worktrees.sh's own header for the full safety envelope.
# Runs ONLY locally — a cloud/remote session has no worktrees to prune.
# Always exits 0; a session start must never be blocked by this cleanup.

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit 0
fi

# Resolve env-var level (session override).
env_mode=""
case "${WORKTREE_AUTO_PRUNE:-}" in
  0 | false | no | off) env_mode="--hook" ;;
  1 | true | yes | on) env_mode="--auto" ;;
esac

# Resolve final mode.
mode="$env_mode"
if [ -z "$mode" ]; then
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"
  settings="$toplevel/.claude/settings.json"
  mode="--auto"
  if [ -f "$settings" ] && command -v jq >/dev/null 2>&1; then
    val="$(jq -r '.worktree.autoPrune' "$settings" 2>/dev/null)"
    [ "$val" = "false" ] && mode="--hook"
  fi
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/prune-merged-worktrees.sh"

if [ -f "$script" ]; then
  bash "$script" "$mode" 2>/dev/null || true
fi
exit 0
