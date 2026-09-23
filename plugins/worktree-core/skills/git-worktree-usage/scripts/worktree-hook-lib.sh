#!/usr/bin/env bash
# sourced-only
# Shared helpers for the git-worktree-usage hook scripts.
#
# Sourced by require-worktree-hook.sh, prune-merged-worktrees-hook.sh, and
# check-worktree-symlinks-hook.sh. Not intended to be run directly.

# Read one value from .claude/settings.json in the current git repo using jq.
#
# Outputs the jq result (or $2 when jq is unavailable, the file is absent, or
# the git repo cannot be located), and returns 0 in all cases.
#
# Usage: read_worktree_setting <jq-expr> [<default>]
#   jq-expr   a jq -r expression, e.g. '.worktree.enforce // "off"'
#   default   emitted when the settings path can't be consulted (default: "")
read_worktree_setting() {
  local jq_expr="$1" default="${2:-}"
  local toplevel
  if ! toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "$default"
    return 0
  fi
  local settings="$toplevel/.claude/settings.json"
  if [ -f "$settings" ] && command -v jq >/dev/null 2>&1; then
    jq -r "$jq_expr" "$settings" 2>/dev/null || printf '%s\n' "$default"
  else
    printf '%s\n' "$default"
  fi
}
