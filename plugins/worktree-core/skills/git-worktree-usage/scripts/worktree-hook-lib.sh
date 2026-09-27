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

# Internal helper for resolve_enable_mode: match <raw> against a list of
# <mode-spec> arguments (see resolve_enable_mode's header for the spec
# format), echoing the first canonical value that matches. Echoes nothing
# (and returns 0) when <raw> is empty or matches no spec.
#
# <aliasing> controls whether the conventional boolean synonyms
# (0/false/no/off, 1/true/yes/on) are recognized:
#   alias    <raw> came from the env var — a session-level override, where
#            the synonyms are part of the documented contract.
#   literal  <raw> came from settings.json — matched only against each
#            spec's own group token, with no synonym translation. A hook
#            whose settings value needs translating (e.g. a JSON boolean)
#            normalizes it to the literal group token in its own jq
#            expression instead (see prune-merged-worktrees-hook.sh).
_worktree_match_mode_spec() {
  local aliasing="$1" raw="$2"
  shift 2
  [ -n "$raw" ] || return 0

  local spec group canonical
  for spec in "$@"; do
    group="${spec%%=*}"
    if [ "$spec" = "$group" ]; then
      canonical="$group"
    else
      canonical="${spec#*=}"
    fi
    if [ "$aliasing" = "alias" ]; then
      case "$group" in
        off)
          case "$raw" in
            0 | false | no | off)
              printf '%s' "$canonical"
              return 0
              ;;
          esac
          ;;
        on)
          case "$raw" in
            1 | true | yes | on)
              printf '%s' "$canonical"
              return 0
              ;;
          esac
          ;;
        *)
          if [ "$raw" = "$group" ]; then
            printf '%s' "$canonical"
            return 0
          fi
          ;;
      esac
    else
      if [ "$raw" = "$group" ]; then
        printf '%s' "$canonical"
        return 0
      fi
    fi
  done
}

# Resolve a hook's final "enable mode", applying the shared precedence every
# worktree hook follows: env var override (if it's a recognized value) wins,
# else the settings.json value (if recognized), else the hook's own default.
# See docs/hook-composition.md for the enable/disable protocol this
# implements.
#
# Each hook defines its own vocabulary of modes and passes each one as a
# <mode-spec>:
#   <token>           matches only the literal string <token> and resolves
#                     to <token> itself, e.g. "warn" or "block".
#   off[=<canonical>] from the env var, matches the conventional "off"
#                     aliases 0/false/no/off; from settings.json, matches
#                     only the literal string "off". Resolves to <canonical>
#                     (or "off" when omitted) either way.
#   on[=<canonical>]  from the env var, matches the conventional "on"
#                     aliases 1/true/yes/on; from settings.json, matches
#                     only the literal string "on". Resolves to <canonical>
#                     (or "on" when omitted) either way.
#
# The boolean synonyms apply only to the env var: it's a session-level
# override where "yes"/"1"/etc. are part of the documented contract. A
# settings.json value is matched literally against each spec's own group
# token, with no synonym translation — a hook whose settings value needs
# translating (e.g. a JSON boolean) embeds that in its own jq expression
# (an `if/elif/else` works well) rather than relying on this function.
#
# Usage:
#   resolve_enable_mode <env-var-name> <settings-jq-expr> \
#     <settings-read-default> <final-default> <mode-spec>...
#
#   env-var-name           name of the env var to consult, e.g. WORKTREE_ENFORCE
#   settings-jq-expr       jq -r expression passed to read_worktree_setting;
#                          include its own `// "default"` fallback here when
#                          a missing key and an explicit falsy value (e.g.
#                          `false`) must be distinguishable — see
#                          prune-merged-worktrees-hook.sh for why that
#                          matters for a boolean setting.
#   settings-read-default  default passed to read_worktree_setting, used only
#                          when the settings file/git/jq can't be consulted
#   final-default          echoed when neither the env var nor the settings
#                          value matches any <mode-spec>
#
# Echoes the resolved mode; always returns 0.
resolve_enable_mode() {
  local env_var_name="$1" jq_expr="$2" settings_read_default="$3" final_default="$4"
  shift 4

  local env_raw resolved
  env_raw="${!env_var_name:-}"
  resolved="$(_worktree_match_mode_spec alias "$env_raw" "$@")"
  if [ -n "$resolved" ]; then
    printf '%s\n' "$resolved"
    return 0
  fi

  local settings_raw
  settings_raw="$(read_worktree_setting "$jq_expr" "$settings_read_default")"
  resolved="$(_worktree_match_mode_spec literal "$settings_raw" "$@")"
  if [ -n "$resolved" ]; then
    printf '%s\n' "$resolved"
    return 0
  fi

  printf '%s\n' "$final_default"
}
