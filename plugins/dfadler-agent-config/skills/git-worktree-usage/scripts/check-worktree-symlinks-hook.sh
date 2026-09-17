#!/usr/bin/env bash
set -uo pipefail

# SessionStart entrypoint: run verify-worktree-symlinks.sh --fix and surface
# its output, but never fail the session over what it finds. This is the
# script wired into this plugin's hooks/hooks.json — see that file's
# SessionStart entry, and verify-worktree-symlinks.sh's own header for what
# it checks and why.
#
# Runs ONLY locally — a cloud/remote session has no worktrees to check.
# Always exits 0, regardless of what the underlying check finds; a session
# start must never be blocked by a symlink health check.

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit 0
fi

# Inhibit: env var (session-level) or worktree.symlinkCheck in settings.json.
case "${WORKTREE_SYMLINK_CHECK:-}" in
  0 | false | no | off) exit 0 ;;
esac
if git_toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  settings="$git_toplevel/.claude/settings.json"
  if [ -f "$settings" ] && command -v jq >/dev/null 2>&1; then
    val="$(jq -r '.worktree.symlinkCheck // "on"' "$settings" 2>/dev/null)"
    [ "$val" = "off" ] && exit 0
  fi
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/verify-worktree-symlinks.sh"

if [ -f "$script" ]; then
  output="$(bash "$script" --fix 2>&1)" || true
  if [ -n "$output" ]; then
    echo "🔗 $output"
  fi
fi
exit 0
