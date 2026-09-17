#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook: block Edit and Write tool calls when the cwd is the main
# git checkout rather than a linked worktree. Keeps the main checkout clean
# by forcing file-modifying work into an isolated branch/worktree. The
# hooks.json matcher filters this to Edit and Write calls only; the check
# itself is intentionally fast (one git command).
#
# Always skipped in cloud/remote sessions (no worktrees there).
# Escape hatch: WORKTREE_ENFORCE=0 (or false/no/off) to bypass the check.

EXIT_OK=0
EXIT_FAILURE=1

# Skip in cloud/remote sessions.
if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit $EXIT_OK
fi

# Escape hatch.
case "${WORKTREE_ENFORCE:-}" in
  0 | false | no | off) exit $EXIT_OK ;;
esac

# Must be inside a git repo to apply.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit $EXIT_OK

# In a linked worktree, git-dir ends in .git/worktrees/<name>.
# In the main checkout it is ".git" (relative) or an absolute path
# ending directly at ".git". If we're in a worktree, allow the edit.
case "$git_dir" in
  *".git/worktrees/"*) exit $EXIT_OK ;;
esac

# We're in the main checkout. Block the file-modifying tool.
printf 'Cannot modify files in the main git checkout.\n'
printf 'Use the EnterWorktree tool to create a linked worktree first,\n'
printf 'or set WORKTREE_ENFORCE=0 to bypass this check.\n'
exit $EXIT_FAILURE
