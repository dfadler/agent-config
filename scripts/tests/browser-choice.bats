#!/usr/bin/env bats
# setup.sh --browser=<playwright|builtin|chrome>: remembered choice, matching
# permissions.deny rules, convention toggle, and teardown. Runs over a COPY of
# the real repo, hermetic like lifecycle-drift.bats.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO"
  cp -R "$REPO_ROOT/scripts" "$REPO_ROOT/claude" "$REPO_ROOT/plugins" "$FAKE_REPO/"
  cp "$REPO_ROOT/setup.sh" "$REPO_ROOT/teardown.sh" "$FAKE_REPO/"
  shim_claude enabled
  shim_rtk
  SETTINGS="$HOME/.claude/settings.json"
  CHOICE="$HOME/.claude/agent-config.browser"
}

teardown() {
  destroy_sandbox
}

denies() { python3 -c 'import json,sys;print(" ".join(json.load(open(sys.argv[1])).get("permissions",{}).get("deny",[])))' "$SETTINGS"; }

@test "no --browser: no choice file, no deny rules (Playwright advice only)" {
  run bash "$FAKE_REPO/setup.sh" --no-companions
  assert_success
  [ ! -e "$CHOICE" ]
  run denies
  [ "$output" = "" ]
}

@test "--browser=playwright denies the other two and enables prefer-real-chrome" {
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=playwright
  assert_success
  assert_output_contains "Note: denying mcp__Claude_Browser__*"
  [ "$(cat "$CHOICE")" = "playwright" ]
  run denies
  [[ "$output" == *"mcp__Claude_Browser__*"* && "$output" == *"mcp__claude-in-chrome__*"* ]]
  run grep -c prefer-real-chrome "$HOME/.claude/CLAUDE.md"
  [ "$output" = "1" ]
}

@test "--browser=builtin keeps the Browser pane, denies Chrome, drops the convention" {
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=chrome
  assert_success
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=builtin
  assert_success
  run denies
  [ "$output" = "mcp__claude-in-chrome__*" ]
  run grep -c prefer-real-chrome "$HOME/.claude/CLAUDE.md"
  [ "$output" = "0" ]
}

@test "choice is remembered: a later plain run re-applies a removed deny rule" {
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=builtin
  assert_success
  printf '{}\n' >"$SETTINGS"
  run bash "$FAKE_REPO/setup.sh" --no-companions
  assert_success
  run denies
  [ "$output" = "mcp__claude-in-chrome__*" ]
}

@test "an unknown --browser value fails before touching anything" {
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=firefox
  [ "$status" -eq 2 ]
  [ ! -e "$HOME/.claude" ]
}

@test "teardown removes the choice file and our deny rules, keeps the user's own" {
  run bash "$FAKE_REPO/setup.sh" --no-companions --browser=playwright
  assert_success
  python3 - "$SETTINGS" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d["permissions"]["deny"].append("Bash(rm -rf *)")
json.dump(d, open(sys.argv[1], "w"))
PY
  run bash "$FAKE_REPO/teardown.sh"
  assert_success
  [ ! -e "$CHOICE" ]
  run denies
  [ "$output" = "Bash(rm -rf *)" ]
}
