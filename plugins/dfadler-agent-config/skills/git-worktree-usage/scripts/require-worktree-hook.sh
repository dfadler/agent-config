#!/usr/bin/env bash
set -uo pipefail

# PreToolUse hook: block/warn/allow Edit and Write tool calls based on whether
# the cwd is the main git checkout rather than a linked worktree.
#
# Off by default — a project must opt in before this hook does anything.
#
# Enforce mode (highest priority first):
#   1. WORKTREE_ENFORCE env var (session-level override):
#      0/false/no/off → off; warn → warn; block → block; anything else → from settings
#   2. worktree.enforce in .claude/settings.json (project config):
#      "block" | "warn" | "off"
#   3. Default: off
#
# Always skipped in cloud/remote sessions (no worktrees there).

EXIT_OK=0
# Claude Code only treats exit 2 as a blocking PreToolUse error; exit 1 with
# plain-text stdout is a non-blocking error and the tool call proceeds.
# https://code.claude.com/docs/en/hooks#exit-code-2
EXIT_FAILURE=2

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$script_dir/worktree-hook-lib.sh"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exit $EXIT_OK
fi

# Resolve env-var level (session override).
env_mode=""
case "${WORKTREE_ENFORCE:-}" in
  0 | false | no | off) env_mode="off" ;;
  warn) env_mode="warn" ;;
  block) env_mode="block" ;;
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
  val="$(read_worktree_setting '.worktree.enforce // "off"' "off")"
  case "$val" in
    off | warn | block) enforce_mode="$val" ;;
    *) enforce_mode="off" ;;
  esac
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
    printf 'Cannot modify files in the main git checkout.\n' >&2
    printf 'Use the EnterWorktree tool to create a linked worktree first,\n' >&2
    printf 'or set worktree.enforce in .claude/settings.json to "warn" or "off".\n' >&2
    exit $EXIT_FAILURE
    ;;
esac
