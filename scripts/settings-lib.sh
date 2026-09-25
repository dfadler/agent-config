#!/usr/bin/env bash
# Helpers for managing ~/.claude/settings.json hook entries.
# Sourced by setup.sh and teardown.sh — do not run directly.
#
# Requires python3 (standard on macOS and all supported platforms).

# ensure_hook_registered EVENT MATCHER COMMAND SETTINGS_FILE
#   Idempotently adds a command hook entry under hooks.<EVENT> in SETTINGS_FILE.
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

event_hooks.append({
    "matcher": matcher,
    "hooks":   [{"type": "command", "command": cmd}],
})

with open(settings_path, "w") as f:
    json.dump(data, f, indent=4)
    f.write("\n")

print("Registered {}/{} hook in {}".format(event, matcher, settings_path))
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
