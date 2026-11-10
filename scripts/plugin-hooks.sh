#!/usr/bin/env bash
# sourced-only
# Loads the plugin hook table (scripts/plugin-hooks.tsv, the single source of
# truth shared with TypeScript) into parallel arrays for setup.sh and the
# setup plan. Sourced by setup.sh, setup-plan-lib.sh and check-companions.sh —
# do not run directly. Also holds hooks_path_is_ours, the one git-hooks helper
# those scripts share (see the end of this file).
#
# Plain indexed arrays (bash 3.2 on macOS has no associative arrays); row i is
# EVENT[i]/MATCHER[i]/FEATURE[i]/CMD[i]/ARGS_JSON[i]/SHELL_CMD[i]/LEGACY_CMD[i].
# A matcher contains "|", so rows are tab-separated, with "-" standing for an
# empty field.
#
#   PLUGIN_HOOK_MATCHERS[i]     "" when the event has no matcher;
#                               ensure_hook_registered then omits "matcher".
#   PLUGIN_HOOK_CMDS[i]         "node": the executable of the exec-form hook
#                               (command + args, no shell, so a HOME with
#                               spaces needs no quoting).
#   PLUGIN_HOOK_ARGS_JSON[i]    JSON array of the args: ["<abs .ts path>"].
#   PLUGIN_HOOK_SHELL_CMDS[i]   The earlier shell-form command, `node "<path>"`
#                               (migration: rewritten to exec form).
#   PLUGIN_HOOK_LEGACY_CMDS[i]  The retired .sh path (migration: deregistered).
#
# shellcheck disable=SC2034  # read by callers after sourcing
PLUGIN_HOOK_EVENTS=()
PLUGIN_HOOK_MATCHERS=()
PLUGIN_HOOK_FEATURES=()
PLUGIN_HOOK_CMDS=()
PLUGIN_HOOK_ARGS_JSON=()
PLUGIN_HOOK_SHELL_CMDS=()
PLUGIN_HOOK_LEGACY_CMDS=()

# _json_string TEXT: TEXT as a JSON string literal (backslash and quote escaped).
_json_string() {
  local s="${1//\\/\\\\}"
  printf '"%s"' "${s//\"/\\\"}"
}

_load_plugin_hooks() {
  local table event matcher feature script legacy path
  table="$(dirname "${BASH_SOURCE[0]}")/plugin-hooks.tsv"
  while IFS=$'\t' read -r event matcher feature script legacy || [[ -n "$event" ]]; do
    case "$event" in '' | '#'*) continue ;; esac
    [[ "$matcher" == "-" ]] && matcher=""
    PLUGIN_HOOK_EVENTS+=("$event")
    PLUGIN_HOOK_MATCHERS+=("$matcher")
    PLUGIN_HOOK_FEATURES+=("$feature")
    path="$HOME/.claude/skills/$script"
    PLUGIN_HOOK_CMDS+=("node")
    PLUGIN_HOOK_ARGS_JSON+=("[$(_json_string "$path")]")
    PLUGIN_HOOK_SHELL_CMDS+=("node \"$path\"")
    PLUGIN_HOOK_LEGACY_CMDS+=("$HOME/.claude/skills/$legacy")
  done <"$table"
}
_load_plugin_hooks

# hooks_path_is_ours VALUE: succeeds when a core.hooksPath VALUE resolves (a
# relative one against the checkout, as git does) to this checkout's own
# scripts/hooks. Compared on resolved physical paths, never as a substring, so
# another repo's hooks, .husky and the like never match. Needs REPO_ROOT.
hooks_path_is_ours() {
  local value="$1" want got
  [[ "$value" == /* ]] || value="$REPO_ROOT/$value"
  want="$(cd -P "$REPO_ROOT/scripts/hooks" 2>/dev/null && pwd -P)" || return 1
  got="$(cd -P "$value" 2>/dev/null && pwd -P)" || return 1
  [[ "$want" == "$got" ]]
}
