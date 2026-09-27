#!/usr/bin/env bash
# sourced-only
# Helpers for managing ~/.claude/settings.json hook entries, plus the shared
# hook table and symlink-resolution helper setup.sh and teardown.sh both
# build on. Sourced by setup.sh and teardown.sh — do not run directly.
#
# Requires python3 (standard on macOS and all supported platforms).

# resolve_symlink_target TARGET LINK_DIR
#   Resolves a symlink's TARGET (as returned by `readlink`) to an absolute
#   path, given LINK_DIR — the directory the symlink itself lives in.
#   TARGET may already be absolute (printed unchanged) or relative (resolved
#   against LINK_DIR, the same way the shell resolves a relative symlink).
#   Works even when TARGET no longer exists, since only its parent directory
#   has to exist for `cd` to succeed. Prints the resolved absolute path and
#   returns 0, or prints nothing and returns 1 if TARGET's parent directory
#   can't be resolved (e.g. it was removed too).
#
#   Single source of truth for relative-symlink-to-absolute-path resolution:
#   setup.sh's prune_skipped_dir_links/prune_stale_plugin_links and
#   teardown.sh's unlink_if_owned/unlink_dir_contents all call this instead
#   of reimplementing the same `cd`-and-`pwd` dance independently.
resolve_symlink_target() {
  local target="$1" link_dir="$2" parent
  if [[ "$target" == /* ]]; then
    printf '%s\n' "$target"
    return 0
  fi
  parent="$(cd "$link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)" || parent=""
  [[ -n "$parent" ]] || return 1
  printf '%s/%s\n' "$parent" "$(basename "$target")"
}

# Hook table: one row per hook this repo registers into ~/.claude/settings.json,
# as parallel arrays (HOOK_TABLE_PLUGIN, HOOK_TABLE_EVENT, HOOK_TABLE_MATCHER,
# HOOK_TABLE_PATH) indexed together — row i is
# (HOOK_TABLE_PLUGIN[i], HOOK_TABLE_EVENT[i], HOOK_TABLE_MATCHER[i], HOOK_TABLE_PATH[i]).
# Parallel arrays rather than one packed "a|b|c" string per row because a
# matcher itself can contain "|" (e.g. "Edit|Write"), which would collide
# with a "|"-delimited row format.
#
#   plugin        the plugin directory name this hook belongs to. setup.sh
#                 registers the hook only while `is_skipped plugin` is false,
#                 and deregisters it otherwise; teardown.sh deregisters every
#                 row unconditionally.
#   event/matcher passed straight through to ensure_hook_registered /
#                 ensure_hook_deregistered. matcher is "" for events with no
#                 matcher concept (SessionStart, Stop, ...).
#   path          the hook script's path relative to
#                 "$HOME/.claude/skills/<plugin>/" (where setup.sh links each
#                 plugin) — hook_command_path below resolves it to the
#                 absolute command path both ensure_hook_registered and
#                 ensure_hook_deregistered expect.
#
# This table is the single source of truth setup.sh (register) and
# teardown.sh (deregister) both iterate — adding a new hook is one row here,
# not a matching edit in both scripts.
HOOK_TABLE_PLUGIN=(
  "worktree-core"
  "worktree-core"
  "worktree-core"
  "dfadler-agent-config"
)
# shellcheck disable=SC2034  # used by callers (setup.sh, teardown.sh) that source this file
HOOK_TABLE_EVENT=(
  "PreToolUse"
  "SessionStart"
  "SessionStart"
  "Stop"
)
# shellcheck disable=SC2034  # used by callers (setup.sh, teardown.sh) that source this file
HOOK_TABLE_MATCHER=(
  "Edit|Write"
  ""
  ""
  ""
)
HOOK_TABLE_PATH=(
  "skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  "skills/git-worktree-usage/scripts/check-worktree-symlinks-hook.sh"
  "skills/git-worktree-usage/scripts/prune-merged-worktrees-hook.sh"
  "hooks/scripts/memory-hygiene-stop-hook.sh"
)

# hook_command_path INDEX
#   Prints the absolute hook command path for HOOK_TABLE row INDEX:
#   "$HOME/.claude/skills/<plugin>/<path>".
hook_command_path() {
  local i="$1"
  printf '%s/.claude/skills/%s/%s\n' "$HOME" "${HOOK_TABLE_PLUGIN[$i]}" "${HOOK_TABLE_PATH[$i]}"
}

# ensure_hook_registered EVENT MATCHER COMMAND SETTINGS_FILE
#   Idempotently adds a command hook entry under hooks.<EVENT> in SETTINGS_FILE.
#   MATCHER may be "" for an event that has no matcher concept (SessionStart,
#   Stop, etc.) — the entry is then written without a "matcher" key at all,
#   matching the shape a plugin's own hooks.json uses for those events,
#   rather than a literal empty string.
#   No-op (silent) if a hook with the same command already exists anywhere
#   under hooks.<EVENT>. Creates SETTINGS_FILE as {} if it does not exist.
#   Prints a single status line on add; nothing if already present.
#   Prints a warning to stderr and returns 0 if python3 is unavailable.
ensure_hook_registered() {
  local event="$1" matcher="$2" cmd="$3" settings="$4"

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'Warning: python3 not found — cannot register %s hook in %s\n' \
      "$event" "$settings" >&2
    return 0
  fi

  if [[ ! -f "$settings" ]]; then
    printf '{}\n' >"$settings"
  fi

  SETTINGS_FILE="$settings" HOOK_EVENT="$event" \
    HOOK_MATCHER="$matcher" HOOK_CMD="$cmd" \
    python3 <<'PYEOF'
import json, os, sys

settings_path = os.environ["SETTINGS_FILE"]
event         = os.environ["HOOK_EVENT"]
matcher       = os.environ["HOOK_MATCHER"]
cmd           = os.environ["HOOK_CMD"]

with open(settings_path) as f:
    data = json.load(f)

hooks       = data.setdefault("hooks", {})
event_hooks = hooks.setdefault(event, [])

for entry in event_hooks:
    if any(h.get("command") == cmd for h in entry.get("hooks", [])):
        sys.exit(0)  # already registered

new_entry = {"hooks": [{"type": "command", "command": cmd}]}
if matcher:
    new_entry["matcher"] = matcher
event_hooks.append(new_entry)

with open(settings_path, "w") as f:
    json.dump(data, f, indent=4)
    f.write("\n")

label = "{}/{}".format(event, matcher) if matcher else event
print("Registered {} hook in {}".format(label, settings_path))
PYEOF
}

# ensure_hook_deregistered EVENT COMMAND SETTINGS_FILE
#   Idempotently removes every hook whose "command" equals COMMAND from all
#   entries under hooks.<EVENT> in SETTINGS_FILE. Entries that become empty
#   after the removal are dropped entirely. The parent hooks.<EVENT> key is
#   removed when it becomes an empty array.
#   No-op (silent) if not present or if SETTINGS_FILE does not exist.
#   Prints a single status line on removal; nothing if already absent.
#   Prints a warning to stderr and returns 0 if python3 is unavailable.
ensure_hook_deregistered() {
  local event="$1" cmd="$2" settings="$3"

  [[ -f "$settings" ]] || return 0

  if ! command -v python3 >/dev/null 2>&1; then
    printf 'Warning: python3 not found — cannot deregister %s hook from %s\n' \
      "$event" "$settings" >&2
    return 0
  fi

  SETTINGS_FILE="$settings" HOOK_EVENT="$event" HOOK_CMD="$cmd" \
    python3 <<'PYEOF'
import json, os, sys

settings_path = os.environ["SETTINGS_FILE"]
event         = os.environ["HOOK_EVENT"]
cmd           = os.environ["HOOK_CMD"]

with open(settings_path) as f:
    data = json.load(f)

hooks       = data.get("hooks", {})
event_hooks = hooks.get(event, [])

new_entries = []
removed     = False
for entry in event_hooks:
    remaining = [h for h in entry.get("hooks", []) if h.get("command") != cmd]
    if len(remaining) < len(entry.get("hooks", [])):
        removed = True
    if remaining:
        new_entry          = dict(entry)
        new_entry["hooks"] = remaining
        new_entries.append(new_entry)

if not removed:
    sys.exit(0)  # not present — nothing to do

if new_entries:
    hooks[event] = new_entries
elif event in hooks:
    del hooks[event]

with open(settings_path, "w") as f:
    json.dump(data, f, indent=4)
    f.write("\n")

print("Deregistered {} hook from {}".format(event, settings_path))
PYEOF
}
