#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook: block/warn/allow Edit and Write tool calls based on whether
# the cwd is the main git checkout rather than a linked worktree.
#
# Enforce mode (highest priority first):
#   1. WORKTREE_ENFORCE env var (session-level override):
#      0/false/no/off → off; warn → warn; anything else → from settings
#   2. worktree.enforce in .claude/settings.json (project config):
#      "block" | "warn" | "off"
#   3. Default: block
#
# Always skipped in cloud/remote sessions (no worktrees there).

EXIT_OK=0
EXIT_FAILURE=1

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit $EXIT_OK
fi

# Resolve env-var level (session override).
env_mode=""
case "${WORKTREE_ENFORCE:-}" in
  0 | false | no | off) env_mode="off" ;;
  warn)                  env_mode="warn" ;;
esac

# Must be inside a git repo to apply.
git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit $EXIT_OK

# In a linked worktree, git-dir ends in .git/worktrees/<name> — allow.
case "$git_dir" in
  *".git/worktrees/"*) exit $EXIT_OK ;;
esac

# We're in the main checkout. Resolve final enforce mode.
enforce_mode="$env_mode"
if [ -z "$enforce_mode" ]; then
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null)"
  settings="$toplevel/.claude/settings.json"
  enforce_mode="block"
  if [ -f "$settings" ] && command -v jq >/dev/null 2>&1; then
    val="$(jq -r '.worktree.enforce // "block"' "$settings" 2>/dev/null)"
    case "$val" in
      off | warn | block) enforce_mode="$val" ;;
    esac
  fi
fi

case "$enforce_mode" in
  off)
    exit $EXIT_OK
    ;;
  warn)
    printf 'Warning: modifying files in the main git checkout.\n'
    printf 'Consider using EnterWorktree for isolated work.\n'
    exit $EXIT_OK
    ;;
  *)
    printf 'Cannot modify files in the main git checkout.\n'
    printf 'Use the EnterWorktree tool to create a linked worktree first,\n'
    printf 'or set worktree.enforce in .claude/settings.json to "warn" or "off".\n'
    exit $EXIT_FAILURE
    ;;
esac
