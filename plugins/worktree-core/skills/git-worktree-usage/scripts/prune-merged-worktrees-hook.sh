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

# Resolve final mode (env var override → settings.json → default ""); see
# resolve_enable_mode's own header. Default "" (rather than "off") means "not
# configured at all" — distinct from an explicit opt-out, which still runs
# the prune script in nudge-only (--hook) mode.
#
# The jq expression translates the JSON boolean itself to "on"/"off" so that
# resolve_enable_mode's settings-side matching — literal, no synonym
# translation — sees exactly the vocabulary in our valid_values list; a
# missing key or explicit null falls through as "unset" (matches neither).
canonical_mode="$(resolve_enable_mode WORKTREE_AUTO_PRUNE \
  '.worktree.autoPrune | if . == true then "on" elif . == false then "off" else "unset" end' \
  "" on off)"

case "$canonical_mode" in
  on) mode="--auto" ;;
  off) mode="--hook" ;;
  *) exit 0 ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/prune-merged-worktrees.sh"

if [ -f "$script" ]; then
  bash "$script" "$mode" 2>/dev/null || true
fi
exit 0
