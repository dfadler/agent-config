#!/usr/bin/env bats
# Dangling-entry detection and repair in scripts/check-companions.sh (doctor):
# hook commands in ~/.claude/settings.json whose script is gone, and symlinks in
# ~/.claude/{skills,commands} whose target is gone.
#
# Hermetic: HOME is the sandbox, REPO_ROOT here is a throwaway copy, and the
# network-blocking shims from helpers.bash are on PATH. python3 is left real
# because the settings-lib helpers --fix calls feed it over stdin.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts" "$HOME/.claude/skills" "$HOME/.claude/commands"
  cp "$REPO_ROOT/scripts/check-companions.sh" "$REPO_ROOT/scripts/settings-lib.sh" "$REPO_ROOT/scripts/plugin-hooks.sh" "$REPO_ROOT/scripts/plugin-hooks.tsv" \
    "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" "$REPO_ROOT/scripts/git-identity.sh" \
    "$FAKE_REPO/scripts/"
  chmod +x "$FAKE_REPO/scripts/"*.sh
  shim_claude enabled
  # Keep --fix off the real rtk binary and config.
  shim_rtk
  printf '[hooks]\nexclude_commands = ["git", "prettier", "eslint", "vitest"]\n' >"$FAKE_RTK_CONFIG"

  STALE="$HOME/.claude/skills/dfadler-agent-config/hooks/scripts/memory-hygiene-stop-hook.sh"
  cat >"$HOME/.claude/settings.json" <<JSON
{
    "hooks": {
        "Stop": [
            {"hooks": [{"type": "command", "command": "$STALE"}]},
            {"hooks": [{"type": "command", "command": "/opt/other-tool/bin/stop.sh"}]}
        ],
        "PreToolUse": [
            {"matcher": "Bash", "hooks": [{"type": "command", "command": "rtk hook claude"}]}
        ]
    }
}
JSON
}

teardown() {
  destroy_sandbox
}

run_doctor() {
  run bash "$FAKE_REPO/scripts/check-companions.sh" "$@"
}

@test "report-only names the stale hook and changes nothing" {
  before="$(cat "$HOME/.claude/settings.json")"
  run_doctor
  assert_success
  assert_output_contains "dangling Stop hook"
  assert_output_contains "memory-hygiene-stop-hook.sh"
  assert_output_contains "./doctor.sh --fix"
  [ "$(cat "$HOME/.claude/settings.json")" = "$before" ]
  [ -z "$(ls "$HOME"/.claude/settings.json.bak-* 2>/dev/null)" ]
}

@test "--fix removes the stale hook, keeps foreign entries, writes a backup" {
  run_doctor --fix
  assert_success
  assert_output_contains "Removing dangling Stop hook"
  assert_output_contains "Backed up"
  ! grep -q memory-hygiene-stop-hook "$HOME/.claude/settings.json"
  grep -q '/opt/other-tool/bin/stop.sh' "$HOME/.claude/settings.json"
  grep -q 'rtk hook claude' "$HOME/.claude/settings.json"
  grep -q memory-hygiene-stop-hook "$HOME"/.claude/settings.json.bak-*
}

@test "a foreign hook with a missing path outside this install is never reported" {
  run_doctor
  refute_output_contains "other-tool"
}

@test "--fix twice is idempotent" {
  run_doctor --fix
  assert_success
  snap="$(cat "$HOME/.claude/settings.json")"
  rm -f "$HOME"/.claude/settings.json.bak-*
  run_doctor --fix
  assert_success
  assert_output_contains "no dangling hook entries or symlinks"
  [ "$(cat "$HOME/.claude/settings.json")" = "$snap" ]
  [ -z "$(ls "$HOME"/.claude/settings.json.bak-* 2>/dev/null)" ]
}

@test "a live hook script is not flagged" {
  mkdir -p "$HOME/.claude/skills/p"
  : >"$HOME/.claude/skills/p/hook.sh"
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node \\"%s\\""}]}]}}\n' \
    "$HOME/.claude/skills/p/hook.sh" >"$HOME/.claude/settings.json"
  run_doctor --fix
  assert_success
  assert_output_contains "no dangling hook entries or symlinks"
}

@test "a symlink into this repo is reported, then removed by --fix" {
  ln -s "$FAKE_REPO/plugins/gone" "$HOME/.claude/skills/gone"
  ln -s "$FAKE_REPO/claude/commands/gone.md" "$HOME/.claude/commands/gone.md"
  run_doctor
  assert_success
  assert_output_contains "dangling symlink"
  [ -L "$HOME/.claude/skills/gone" ]
  run_doctor --fix
  assert_success
  assert_output_contains "Removed dangling symlink: $HOME/.claude/skills/gone"
  [ ! -L "$HOME/.claude/skills/gone" ]
  [ ! -L "$HOME/.claude/commands/gone.md" ]
}

@test "a dangling symlink pointing elsewhere is left alone" {
  ln -s /nonexistent/elsewhere "$HOME/.claude/skills/foreign"
  run_doctor --fix
  assert_success
  [ -L "$HOME/.claude/skills/foreign" ]
}

@test "--fix keeps the stale hook when the settings backup fails" {
  mkdir -p "$SANDBOX/shims"
  printf '#!/bin/sh\nexit 1\n' >"$SANDBOX/shims/cp"
  chmod +x "$SANDBOX/shims/cp"
  before="$(cat "$HOME/.claude/settings.json")"
  PATH="$SANDBOX/shims:$PATH" run_doctor --fix
  assert_output_contains "could not back up"
  [ "$(cat "$HOME/.claude/settings.json")" = "$before" ]
}

# ---------------------------------------------------------------------------
# Exec-form hooks (command + args)
# ---------------------------------------------------------------------------

@test "an exec-form hook whose script arg is gone is reported, then removed by --fix" {
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node","args":["%s"]}]}]}}\n' \
    "$HOME/.claude/skills/p/gone.ts" >"$HOME/.claude/settings.json"
  run_doctor
  assert_success
  assert_output_contains "dangling Stop hook"
  assert_output_contains "gone.ts"
  run_doctor --fix
  assert_output_contains "Removing dangling Stop hook"
  run grep -c "gone.ts" "$HOME/.claude/settings.json"
  [ "$output" = "0" ]
}

@test "an exec-form hook with a live script arg is not flagged" {
  mkdir -p "$HOME/.claude/skills/p"
  : >"$HOME/.claude/skills/p/hook.ts"
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node","args":["%s"]}]}]}}\n' \
    "$HOME/.claude/skills/p/hook.ts" >"$HOME/.claude/settings.json"
  run_doctor --fix
  assert_success
  assert_output_contains "no dangling hook entries or symlinks"
}

@test "removing a dangling exec-form hook leaves a shell-form one that shares its command" {
  mkdir -p "$HOME/.claude/skills/p"
  : >"$HOME/.claude/skills/p/live.ts"
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node","args":["%s"]},{"type":"command","command":"node \\"%s\\""}]}]}}\n' \
    "$HOME/.claude/skills/p/gone.ts" "$HOME/.claude/skills/p/live.ts" >"$HOME/.claude/settings.json"
  run_doctor --fix
  run python3 -c "
import json
hooks = json.load(open('$HOME/.claude/settings.json'))['hooks']['Stop'][0]['hooks']
assert [h['command'] for h in hooks] == ['node \"$HOME/.claude/skills/p/live.ts\"'], hooks
"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Shell-form entries from this repo's hook table are flagged, and --fix
# migrates them to exec form.
# ---------------------------------------------------------------------------

shell_form_settings() {
  SHELL_SCRIPT="$HOME/.claude/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts"
  mkdir -p "${SHELL_SCRIPT%/*}"
  : >"$SHELL_SCRIPT"
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"node \\"%s\\""},{"type":"command","command":"foreign"}]}]}}\n' \
    "$SHELL_SCRIPT" >"$HOME/.claude/settings.json"
}

@test "shell-form: a table hook in shell form is reported and left alone without --fix" {
  shell_form_settings
  before="$(cat "$HOME/.claude/settings.json")"
  run_doctor
  assert_success
  assert_output_contains "shell-form Stop hook"
  [ "$(cat "$HOME/.claude/settings.json")" = "$before" ]
}

@test "shell-form: --fix migrates it to exec form with a backup, keeps foreign hooks, and is idempotent" {
  shell_form_settings
  run_doctor --fix
  assert_success
  assert_output_contains "Migrated Stop hook to exec form"
  [ -n "$(ls "$HOME"/.claude/settings.json.bak-* 2>/dev/null)" ]
  run python3 -c "
import json
hooks = json.load(open('$HOME/.claude/settings.json'))['hooks']['Stop'][0]['hooks']
assert hooks[0] == {'type': 'command', 'command': 'node', 'args': ['$SHELL_SCRIPT']}, hooks
assert hooks[1]['command'] == 'foreign', hooks
"
  [ "$status" -eq 0 ]
  run_doctor --fix
  assert_output_contains "no shell-form hook entries"
}
