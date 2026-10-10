#!/usr/bin/env bats
# Dangling @-include detection and repair in scripts/check-companions.sh
# (doctor) for ~/.claude/CLAUDE.md and ~/.claude/CLAUDE.personal.md.
# Hermetic: HOME is the sandbox and the repo is a throwaway copy.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts" "$FAKE_REPO/claude/conventions" \
    "$FAKE_REPO/plugins/shell-script-hygiene" "$HOME/.claude"
  cp "$REPO_ROOT/scripts/check-companions.sh" "$REPO_ROOT/scripts/settings-lib.sh" \
    "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" "$REPO_ROOT/scripts/git-identity.sh" \
    "$FAKE_REPO/scripts/"
  chmod +x "$FAKE_REPO/scripts/"*.sh
  shim_claude enabled
  shim_rtk
  printf '[hooks]\nexclude_commands = ["git", "prettier", "eslint", "vitest"]\n' >"$FAKE_RTK_CONFIG"
  : >"$FAKE_REPO/claude/conventions/keep.md"
  P="$HOME/.claude/CLAUDE.personal.md"
  cat >"$P" <<MD
@$FAKE_REPO/claude/conventions/keep.md
@$FAKE_REPO/claude/conventions/shell-script-hygiene.md
@$FAKE_REPO/claude/conventions/gone.md
@RTK.md
@/opt/elsewhere/missing.md
plain text line
MD
  printf '@CLAUDE.personal.md\n' >"$HOME/.claude/CLAUDE.md"
}

teardown() {
  destroy_sandbox
}

run_doctor() {
  run bash "$FAKE_REPO/scripts/check-companions.sh" "$@"
}

@test "report-only lists file:line, skill hint, warns on foreign, changes nothing" {
  before="$(cat "$P")"
  run_doctor
  assert_success
  assert_output_contains "CLAUDE.personal.md:2 includes a file that no longer exists"
  assert_output_contains "now loads as the shell-script-hygiene skill"
  assert_output_contains "CLAUDE.personal.md:3 includes"
  assert_output_contains "CLAUDE.personal.md:4 includes a missing file (left alone"
  assert_output_contains "CLAUDE.personal.md:5 includes a missing file (left alone"
  assert_output_contains "./doctor.sh --fix"
  [ "$(cat "$P")" = "$before" ]
  [ -z "$(ls "$HOME"/.claude/*.bak-* 2>/dev/null)" ]
}

@test "--fix removes only repo-owned lines and writes a backup" {
  before="$(cat "$P")"
  run_doctor --fix
  assert_success
  assert_output_contains "Removing dangling include from $P:2"
  [ "$(grep -c . "$P")" = 4 ]
  grep -q 'keep.md' "$P"
  grep -q '^@RTK.md$' "$P"
  grep -q '/opt/elsewhere/missing.md' "$P"
  grep -q 'plain text line' "$P"
  ! grep -q 'gone.md' "$P"
  [ "$(cat "$HOME"/.claude/CLAUDE.personal.md.bak-*)" = "$before" ]
}

@test "--fix aborts the removal when the backup fails" {
  mkdir -p "$SANDBOX/shims"
  printf '#!/bin/sh\nexit 1\n' >"$SANDBOX/shims/cp"
  chmod +x "$SANDBOX/shims/cp"
  before="$(cat "$P")"
  PATH="$SANDBOX/shims:$PATH" run_doctor --fix
  assert_output_contains "could not back up"
  [ "$(cat "$P")" = "$before" ]
}

@test "--fix twice is idempotent" {
  run_doctor --fix
  snap="$(cat "$P")"
  rm -f "$HOME"/.claude/*.bak-*
  run_doctor --fix
  assert_success
  refute_output_contains "Removing dangling include"
  [ "$(cat "$P")" = "$snap" ]
  [ -z "$(ls "$HOME"/.claude/*.bak-* 2>/dev/null)" ]
}

@test "clean state reports success" {
  printf '@%s/claude/conventions/keep.md\n' "$FAKE_REPO" >"$P"
  run_doctor --fix
  assert_success
  assert_output_contains "no dangling @-includes"
}
