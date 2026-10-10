#!/usr/bin/env bash
# sourced-only
# Single source of truth for the plugin hook command paths setup.sh registers
# and teardown.sh deregisters in ~/.claude/settings.json. Sourced by both — do
# not run directly.
#
# Before this table existed, both scripts hardcoded the same four command
# paths independently (setup.sh to call ensure_hook_registered/
# ensure_hook_deregistered per --skip/--include state, teardown.sh to call
# ensure_hook_deregistered unconditionally) — nothing but bats coverage
# enforced the two stayed in sync. Adding a hook now means adding one row
# here instead of matching edits in both files.
#
# Four parallel arrays, one row per hook, indexed together (row i is
# EVENT[i]/MATCHER[i]/FEATURE[i]/CMD[i]). A packed "field|field|..." string
# per row was considered instead, but MATCHER values themselves contain "|"
# (e.g. "Edit|Write"), which would collide with a "|"-delimited row format;
# parallel arrays sidestep that with no delimiter to collide. Plain indexed
# arrays (not associative) because this repo's macOS-shipped bash (3.2)
# target has no associative-array support — see setup.sh's SKIP_FEATURES
# comment for the same constraint.
#
#   PLUGIN_HOOK_EVENTS[i]    Hook event name (PreToolUse, SessionStart, Stop, ...).
#   PLUGIN_HOOK_MATCHERS[i]  Tool matcher regex, or "" for an event with no
#                            matcher concept — passed straight through to
#                            ensure_hook_registered, which omits the "matcher"
#                            key entirely when this is empty.
#   PLUGIN_HOOK_FEATURES[i]  The --skip/--include feature name (a plugin
#                            directory name) that owns this hook. setup.sh
#                            registers the hook when this feature is not
#                            skipped, and deregisters it when the feature is
#                            skipped. teardown.sh deregisters every row
#                            unconditionally, regardless of this field.
#   PLUGIN_HOOK_CMDS[i]      Command line (`node "<abs .ts path>"`) for the hook
#                            script under ~/.claude/skills, matching where
#                            setup.sh links each plugin. Quoted so a HOME with
#                            spaces survives the shell. PLUGIN_HOOK_LEGACY_CMDS[i]
#                            is the retired .sh path for the same row.
#
# shellcheck disable=SC2034  # read by setup.sh/teardown.sh after sourcing
PLUGIN_HOOK_EVENTS=(
  "PreToolUse"
  "SessionStart"
  "SessionStart"
  "Stop"
)
# shellcheck disable=SC2034
PLUGIN_HOOK_MATCHERS=(
  "Edit|Write"
  ""
  ""
  ""
)
# shellcheck disable=SC2034
PLUGIN_HOOK_FEATURES=(
  "worktree-core"
  "worktree-core"
  "worktree-core"
  "memory-hygiene"
)
# shellcheck disable=SC2034
PLUGIN_HOOK_CMDS=(
  "node \"$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts\""
  "node \"$HOME/.claude/skills/worktree-core/scripts/ts/check-worktree-symlinks-hook.ts\""
  "node \"$HOME/.claude/skills/worktree-core/scripts/ts/prune-merged-worktrees-hook.ts\""
  "node \"$HOME/.claude/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\""
)
# Retired .sh shim commands (removed in #441 phase 6). setup.sh deregisters
# any still present in settings.json (migration) and teardown.sh sweeps them
# too, so no hook is left pointing at a deleted file. Rows pair with the
# arrays above by index (same event).
# shellcheck disable=SC2034
PLUGIN_HOOK_LEGACY_CMDS=(
  "$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  "$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/check-worktree-symlinks-hook.sh"
  "$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/prune-merged-worktrees-hook.sh"
  "$HOME/.claude/skills/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
)
