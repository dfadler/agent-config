#!/usr/bin/env bash
# sourced-only
# Helpers for managing ~/.claude/settings.json hook entries.
# Sourced by setup.sh and teardown.sh — do not run directly.
#
# Requires python3 (standard on macOS and all supported platforms).

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
    original = entry.get("hooks", [])
    remaining = [h for h in original if h.get("command") != cmd]
    entry_changed = len(remaining) < len(original)
    if entry_changed:
        removed = True
    # Drop an entry only when THIS removal emptied it out — an entry that
    # was already "hooks": [] (foreign, or otherwise not ours) is preserved
    # as-is rather than silently swept away just because some other entry
    # in the same event happened to lose its last hook in this same pass.
    if remaining or not entry_changed:
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

# hook_registration_state EVENT COMMAND SETTINGS_FILE
#   Read-only probe: never writes. Returns 0 if a hook with COMMAND is
#   registered under hooks.<EVENT>, 1 if it is not (including when
#   SETTINGS_FILE is missing), and 2 if that cannot be determined (python3
#   unavailable, or SETTINGS_FILE is not valid JSON). Prints nothing.
hook_registration_state() {
  local event="$1" cmd="$2" settings="$3"

  [[ -f "$settings" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 2

  local rc=0
  SETTINGS_FILE="$settings" HOOK_EVENT="$event" HOOK_CMD="$cmd" \
    python3 <<'PYEOF' || rc=$?
import json, os, sys

try:
    with open(os.environ["SETTINGS_FILE"]) as f:
        data = json.load(f)
    entries = data.get("hooks", {}).get(os.environ["HOOK_EVENT"], [])
    found = any(
        h.get("command") == os.environ["HOOK_CMD"]
        for entry in entries
        for h in entry.get("hooks", [])
    )
except Exception:
    sys.exit(2)
sys.exit(0 if found else 1)
PYEOF
  return "$rc"
}
