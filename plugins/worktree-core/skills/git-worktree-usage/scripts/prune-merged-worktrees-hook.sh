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

# Resolve final mode: WORKTREE_AUTO_PRUNE env var (session override) wins if
# set to a recognized value, else worktree.autoPrune in settings.json, else
# empty ("not configured" — skip; there is no third default mode here).
#
# No `// empty` in the jq expr: jq's `//` treats a literal `false` as falsy,
# which would swallow an explicit autoPrune:false the same as a missing key.
# The "null" settings-read default lets us distinguish null from false.
mode="$(resolve_enable_mode WORKTREE_AUTO_PRUNE '.worktree.autoPrune' "null" "" off=--hook on=--auto)"

if [ -z "$mode" ]; then
  exit 0
fi

script="$script_dir/prune-merged-worktrees.sh"

if [ -f "$script" ]; then
  bash "$script" "$mode" 2>/dev/null || true
fi
exit 0
