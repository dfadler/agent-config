#!/usr/bin/env bats
# Tests for scripts/settings-lib.sh — ensure_hook_registered and
# ensure_hook_deregistered.
#
# Hermetic: HOME is redirected into a sandbox (via helpers.bash make_sandbox).
# All file I/O stays inside the sandbox; the developer's real ~/.claude is
# never touched.

bats_require_minimum_version 1.5.0

load helpers

SETTINGS_LIB="$REPO_ROOT/scripts/settings-lib.sh"

setup() {
  make_sandbox
  # shellcheck source=/dev/null
  source "$SETTINGS_LIB"
  SETTINGS="$SANDBOX/settings.json"
}

teardown() {
  destroy_sandbox
}

# ---------------------------------------------------------------------------
# ensure_hook_registered
# ---------------------------------------------------------------------------

@test "registered: creates settings.json when absent" {
  ensure_hook_registered "PreToolUse" "Edit|Write" "/path/to/hook.sh" "$SETTINGS"
  [ -f "$SETTINGS" ]
}

@test "registered: adds hook entry to empty {}" {
  printf '{}' >"$SETTINGS"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/path/to/hook.sh" "$SETTINGS"
  run python3 -c "
import json, sys
d = json.load(open('$SETTINGS'))
hooks = d['hooks']['PreToolUse']
assert any(h['command'] == '/path/to/hook.sh' for e in hooks for h in e['hooks']), 'hook not found'
"
  [ "$status" -eq 0 ]
}

@test "registered: prints a status line on add" {
  printf '{}' >"$SETTINGS"
  run bash -c "source '$SETTINGS_LIB'; ensure_hook_registered PreToolUse 'Edit|Write' /path/to/hook.sh '$SETTINGS'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Registered"* ]]
}

@test "registered: idempotent — no duplicate on re-run" {
  printf '{}' >"$SETTINGS"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/path/to/hook.sh" "$SETTINGS"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/path/to/hook.sh" "$SETTINGS"
  run python3 -c "
import json, sys
d = json.load(open('$SETTINGS'))
entries = d['hooks']['PreToolUse']
count = sum(1 for e in entries for h in e['hooks'] if h['command'] == '/path/to/hook.sh')
assert count == 1, 'expected 1, got {}'.format(count)
"
  [ "$status" -eq 0 ]
}

@test "registered: idempotent — prints nothing when already present" {
  printf '{}' >"$SETTINGS"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/path/to/hook.sh" "$SETTINGS"
  run bash -c "source '$SETTINGS_LIB'; ensure_hook_registered PreToolUse 'Edit|Write' /path/to/hook.sh '$SETTINGS'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "registered: preserves existing hooks under same event" {
  python3 -c "
import json
d = {'hooks': {'PreToolUse': [{'matcher': 'Bash', 'hooks': [{'type': 'command', 'command': '/existing/hook.sh'}]}]}}
open('$SETTINGS', 'w').write(json.dumps(d))
"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/new/hook.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
cmds = [h['command'] for e in d['hooks']['PreToolUse'] for h in e['hooks']]
assert '/existing/hook.sh' in cmds, 'existing hook lost'
assert '/new/hook.sh' in cmds, 'new hook missing'
"
  [ "$status" -eq 0 ]
}

@test "registered: preserves hooks under other events" {
  python3 -c "
import json
d = {'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': '/session/hook.sh'}]}]}}
open('$SETTINGS', 'w').write(json.dumps(d))
"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/new/hook.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
assert 'SessionStart' in d['hooks'], 'SessionStart key lost'
"
  [ "$status" -eq 0 ]
}

@test "registered: no-op with warning when python3 absent" {
  # Create an empty fake_bin dir that precedes /usr/bin so python3 is not found.
  # The absent-python3 code path uses only bash builtins (printf, return), so
  # /usr/bin is not needed for the code under test. bash itself lives at /bin/bash.
  local fake_bin="$SANDBOX/no-python3-bin"
  mkdir "$fake_bin"
  run env -i "HOME=$HOME" "PATH=$fake_bin:/bin" \
    bash -c "source '$SETTINGS_LIB'; ensure_hook_registered PreToolUse 'Edit|Write' /hook.sh '$SETTINGS' 2>&1"
  [ "$status" -eq 0 ]
  [ ! -f "$SETTINGS" ]
  [[ "$output" == *"Warning"* ]]
}

# ---------------------------------------------------------------------------
# ensure_hook_deregistered
# ---------------------------------------------------------------------------

@test "deregistered: no-op when settings.json absent" {
  run bash -c "source '$SETTINGS_LIB'; ensure_hook_deregistered PreToolUse /hook.sh '$SETTINGS'"
  [ "$status" -eq 0 ]
  [ ! -f "$SETTINGS" ]
}

@test "deregistered: no-op (silent) when hook not present" {
  printf '{}' >"$SETTINGS"
  run bash -c "source '$SETTINGS_LIB'; ensure_hook_deregistered PreToolUse /hook.sh '$SETTINGS'"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "deregistered: removes the hook entry" {
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook.sh" "$SETTINGS"
  ensure_hook_deregistered "PreToolUse" "/hook.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e['hooks']]
assert '/hook.sh' not in cmds, 'hook still present'
"
  [ "$status" -eq 0 ]
}

@test "deregistered: prints a status line on removal" {
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook.sh" "$SETTINGS"
  run bash -c "source '$SETTINGS_LIB'; ensure_hook_deregistered PreToolUse /hook.sh '$SETTINGS'"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Deregistered"* ]]
}

@test "deregistered: removes empty PreToolUse key when last entry gone" {
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook.sh" "$SETTINGS"
  ensure_hook_deregistered "PreToolUse" "/hook.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
assert 'PreToolUse' not in d.get('hooks', {}), 'empty PreToolUse key left behind'
"
  [ "$status" -eq 0 ]
}

@test "deregistered: leaves other hooks under same event intact" {
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook-a.sh" "$SETTINGS"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook-b.sh" "$SETTINGS"
  ensure_hook_deregistered "PreToolUse" "/hook-a.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
cmds = [h['command'] for e in d['hooks']['PreToolUse'] for h in e['hooks']]
assert '/hook-a.sh' not in cmds, 'hook-a still present'
assert '/hook-b.sh' in cmds, 'hook-b missing'
"
  [ "$status" -eq 0 ]
}

@test "deregistered: leaves hooks under other events intact" {
  python3 -c "
import json
d = {'hooks': {'SessionStart': [{'hooks': [{'type': 'command', 'command': '/session/hook.sh'}]}]}}
open('$SETTINGS', 'w').write(json.dumps(d))
"
  ensure_hook_registered "PreToolUse" "Edit|Write" "/hook.sh" "$SETTINGS"
  ensure_hook_deregistered "PreToolUse" "/hook.sh" "$SETTINGS"
  run python3 -c "
import json
d = json.load(open('$SETTINGS'))
assert 'SessionStart' in d['hooks'], 'SessionStart key lost'
"
  [ "$status" -eq 0 ]
}
