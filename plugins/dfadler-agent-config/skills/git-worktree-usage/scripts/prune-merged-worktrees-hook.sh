#!/usr/bin/env bash
set -uo pipefail

# SessionStart entrypoint: auto-remove any Claude worktree whose PR has
# already merged, so stale worktrees don't pile up under .claude/worktrees/.
# The heavy lifting (and the whole safety envelope) lives in
# prune-merged-worktrees.sh; this hook just points it at its quiet, non-fatal
# --auto mode and prints its short "removed X" summary. This is the script
# wired into this plugin's hooks/hooks.json — see that file's SessionStart
# entry, and prune-merged-worktrees.sh's own header for the exact scope and
# safety rules.
#
# Escape hatch: set WORKTREE_AUTO_PRUNE=0 (or false/no/off) to fall back to a
# read-only nudge — it then only tells you what *could* be pruned and leaves
# removal to a manual `prune-merged-worktrees.sh --yes`.
#
# Runs ONLY locally — a cloud/remote session has no worktrees to prune.
# Always exits 0, regardless of what the underlying prune finds; a session
# start must never be blocked by this cleanup.

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit 0
fi

# Opt out of auto-removal → report-only nudge. Any other value auto-removes.
mode="--auto"
case "${WORKTREE_AUTO_PRUNE:-}" in
  0 | false | no | off) mode="--hook" ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/prune-merged-worktrees.sh"

if [ -f "$script" ]; then
  bash "$script" "$mode" 2>/dev/null || true
fi
exit 0
