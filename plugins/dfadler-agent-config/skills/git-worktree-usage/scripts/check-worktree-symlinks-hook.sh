#!/usr/bin/env bash
set -uo pipefail

# SessionStart entrypoint: run verify-worktree-symlinks.sh --fix and surface
# its output, but never fail the session over what it finds. This is the
# script wired into this plugin's hooks/hooks.json — see that file's
# SessionStart entry, and verify-worktree-symlinks.sh's own header for what
# it checks and why.
#
# Off by default — a project must opt in (WORKTREE_SYMLINK_CHECK=on, or
# worktree.symlinkCheck: "on" in .claude/settings.json) before this hook
# does anything.
#
# Runs ONLY locally — a cloud/remote session has no worktrees to check.
# Always exits 0, regardless of what the underlying check finds; a session
# start must never be blocked by a symlink health check.

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit 0
fi

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$script_dir/worktree-hook-lib.sh"

# Resolve enable signal (env var → settings.json → off).
case "${WORKTREE_SYMLINK_CHECK:-}" in
  0 | false | no | off) exit 0 ;;
  1 | true | yes | on) : ;; # explicit opt-in, fall through to run the check
  *)
    val="$(read_worktree_setting '.worktree.symlinkCheck // "off"' "off")"
    [ "$val" = "on" ] || exit 0
    ;;
esac

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="$script_dir/verify-worktree-symlinks.sh"

if [ -f "$script" ]; then
  output="$(bash "$script" --fix 2>&1)" || true
  if [ -n "$output" ]; then
    echo "🔗 $output"
  fi
fi
exit 0
