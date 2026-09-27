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

# Map the common boolean-ish env-var spellings to canonical "on"/"off";
# anything else (including an empty/unset value) passes through unchanged so
# a hook's own literal vocabulary (e.g. "warn", "block") can still be matched
# against by the caller.
_worktree_normalize_enable_value() {
  case "$1" in
    0 | false | no | off) printf 'off' ;;
    1 | true | yes | on) printf 'on' ;;
    *) printf '%s' "$1" ;;
  esac
}

# True (exit 0) when $1 is one of the remaining args.
_worktree_enable_value_in() {
  local needle="$1" candidate
  shift
  for candidate in "$@"; do
    [ "$needle" = "$candidate" ] && return 0
  done
  return 1
}

# Resolve an enable-mode value shared by all three worktree hooks, using the
# documented precedence order (see docs/hook-composition.md):
#   1. <env_var> — a session-level override. Recognizes the boolean synonyms
#      0/false/no/off and 1/true/yes/on (normalized to "off"/"on") in
#      addition to any of <valid_values> given literally (e.g. "warn",
#      "block"). Unset, or set to a value that normalizes to neither a
#      synonym nor a literal member of <valid_values>, falls through to
#      settings.json.
#   2. <settings_key> — a jq -r expression read from the project's
#      .claude/settings.json via read_worktree_setting, matched literally
#      against <valid_values> with no synonym translation. If a hook's
#      settings value needs translating (e.g. a JSON boolean to "on"/"off"),
#      embed that in the jq expression itself (an `if/elif/else` works well)
#      rather than relying on this function's synonym table, which applies
#      to the env var only.
#   3. <default> — returned as-is when neither of the above yields a member
#      of <valid_values>. <default> need not itself be a member of
#      <valid_values>; e.g. prune-merged-worktrees-hook.sh passes "" to mean
#      "not configured at all," distinct from an explicit "off".
#
# Usage: resolve_enable_mode <env_var> <settings_key> <default> <valid_values...>
resolve_enable_mode() {
  local env_var="$1" settings_key="$2" default="$3"
  shift 3
  local candidate value

  candidate="$(_worktree_normalize_enable_value "${!env_var:-}")"
  if [ -n "$candidate" ] && _worktree_enable_value_in "$candidate" "$@"; then
    printf '%s\n' "$candidate"
    return 0
  fi

  value="$(read_worktree_setting "$settings_key" "$default")"
  if _worktree_enable_value_in "$value" "$@"; then
    printf '%s\n' "$value"
    return 0
  fi

  printf '%s\n' "$default"
}
