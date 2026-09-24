#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# prune-merged-worktrees-hook.sh — the SessionStart hook that auto-removes
# merged worktrees or nudges only, based on configured auto-prune mode.
#
# Hermetic: the REAL hook script is copied into a throwaway directory alongside
# a FAKE prune-merged-worktrees.sh (logs argv to CALL_LOG, prints controllable
# stdout/stderr) and a fake `git` shim (returns TMP as --show-toplevel). The
# hook locates its sibling via $(dirname "$0"), so copying both into one dir
# substitutes the fake without touching any real git, worktree, or network.

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/prune-merged-worktrees-hook.sh"
HOOK_LIB="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/worktree-hook-lib.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/prune-merged-worktrees-hook.sh"
  cp "$HOOK_LIB" "$TMP/worktree-hook-lib.sh"
  SCRIPT_UNDER_TEST="$TMP/prune-merged-worktrees-hook.sh"
  CALL_LOG="$TMP/calls.log"
  GIT_SHIM="$TMP/shim-bin"
  mkdir -p "$GIT_SHIM" "$TMP/.claude"
  : >"$CALL_LOG"
  export CALL_LOG GIT_SHIM TMP

  # Fake git shim: returns TMP as show-toplevel; delegates everything else.
  cat >"$GIT_SHIM/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--show-toplevel" ]; then
  printf '%s\n' "${FAKE_GIT_TOPLEVEL:-}"
  exit 0
fi
exec git "$@"
EOF
  chmod +x "$GIT_SHIM/git"
  export FAKE_GIT_TOPLEVEL="$TMP"
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

_install_fake_prune() {
  cat >"$TMP/prune-merged-worktrees.sh" <<'EOF'
#!/usr/bin/env bash
echo "prune called: $*" >>"$CALL_LOG"
if [ -n "${FAKE_STDOUT:-}" ]; then
  echo "$FAKE_STDOUT"
fi
if [ -n "${FAKE_STDERR:-}" ]; then
  echo "$FAKE_STDERR" >&2
fi
[ -n "${FAKE_EXIT:-}" ] && exit "$FAKE_EXIT"
exit 0
EOF
  chmod +x "$TMP/prune-merged-worktrees.sh"
}

_write_settings_auto_prune() {
  printf '{"worktree":{"autoPrune":%s}}\n' "$1" >"$TMP/.claude/settings.json"
}

# run_hook [env=val ...] — run the real hook with git shim on PATH.
run_hook() {
  run env -u WORKTREE_AUTO_PRUNE -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    FAKE_GIT_TOPLEVEL="$TMP" \
    "$@" /bin/bash "$SCRIPT_UNDER_TEST"
}

@test "remote: exits 0 immediately, never invokes the prune script" {
  _install_fake_prune
  run env CLAUDE_CODE_REMOTE=true /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  [ ! -s "$CALL_LOG" ]
}

@test "prune script missing: exits 0 with no output, no crash" {
  run_hook CLAUDE_CODE_REMOTE=false
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "default (nothing configured): never invokes prune at all" {
  _install_fake_prune
  run_hook
  [ "$status" -eq 0 ]
  [ ! -s "$CALL_LOG" ]
}

@test "WORKTREE_AUTO_PRUNE=0 opts out: invokes prune in --hook mode" {
  _install_fake_prune
  run env WORKTREE_AUTO_PRUNE=0 PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$TMP" /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  grep -q -- "--hook" "$CALL_LOG"
}

@test "WORKTREE_AUTO_PRUNE=false/no/off all opt out to --hook mode" {
  _install_fake_prune
  for val in false no off; do
    : >"$CALL_LOG"
    run env WORKTREE_AUTO_PRUNE="$val" PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$TMP" /bin/bash "$SCRIPT_UNDER_TEST"
    [ "$status" -eq 0 ]
    grep -q -- "--hook" "$CALL_LOG"
  done
}

@test "WORKTREE_AUTO_PRUNE=1/true/yes/on all opt in to --auto mode" {
  _install_fake_prune
  for val in 1 true yes on; do
    : >"$CALL_LOG"
    run env WORKTREE_AUTO_PRUNE="$val" PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$TMP" /bin/bash "$SCRIPT_UNDER_TEST"
    [ "$status" -eq 0 ]
    grep -q -- "--auto" "$CALL_LOG"
    ! grep -q -- "--hook" "$CALL_LOG"
  done
}

@test "opted in, prune script's stdout passes through the hook" {
  _install_fake_prune
  run_hook WORKTREE_AUTO_PRUNE=on FAKE_STDOUT="removed 2 merged worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 2 merged worktrees"* ]]
}

@test "opted in, prune script's stderr is suppressed" {
  _install_fake_prune
  run_hook WORKTREE_AUTO_PRUNE=on FAKE_STDERR="a warning nobody should see"
  [ "$status" -eq 0 ]
  [[ "$output" != *"a warning nobody should see"* ]]
}

@test "opted in, a failing prune script is swallowed — the hook still exits 0" {
  _install_fake_prune
  run_hook WORKTREE_AUTO_PRUNE=on FAKE_EXIT=1
  [ "$status" -eq 0 ]
  [ -s "$CALL_LOG" ]
}

# ---------------------------------------------------------------------------
# worktree.autoPrune in settings.json: project-level config.
# ---------------------------------------------------------------------------

@test "settings autoPrune=false: invokes prune in --hook mode" {
  _install_fake_prune
  _write_settings_auto_prune "false"
  run_hook
  [ "$status" -eq 0 ]
  grep -q -- "--hook" "$CALL_LOG"
  ! grep -q -- "--auto" "$CALL_LOG"
}

@test "settings autoPrune=true: invokes prune in --auto mode" {
  _install_fake_prune
  _write_settings_auto_prune "true"
  run_hook
  [ "$status" -eq 0 ]
  grep -q -- "--auto" "$CALL_LOG"
  ! grep -q -- "--hook" "$CALL_LOG"
}

@test "env var takes priority over settings: WORKTREE_AUTO_PRUNE=0 overrides autoPrune=true" {
  _install_fake_prune
  _write_settings_auto_prune "true"
  run env WORKTREE_AUTO_PRUNE=0 PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$TMP" /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  grep -q -- "--hook" "$CALL_LOG"
}

@test "env var takes priority over settings: WORKTREE_AUTO_PRUNE=on overrides autoPrune=false" {
  _install_fake_prune
  _write_settings_auto_prune "false"
  run env WORKTREE_AUTO_PRUNE=on PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$TMP" /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  grep -q -- "--auto" "$CALL_LOG"
}

@test "jq fails: falls back to skip (never invokes prune) even if settings says false" {
  _install_fake_prune
  _write_settings_auto_prune "false"
  # Put a broken jq in GIT_SHIM (first on PATH) that always exits 1.
  # Simulates jq failing to parse; the hook can't read settings, so it should
  # fall back to the off-by-default skip rather than guessing a mode.
  printf '#!/usr/bin/env bash\nexit 1\n' >"$GIT_SHIM/jq"
  chmod +x "$GIT_SHIM/jq"
  run_hook
  [ "$status" -eq 0 ]
  [ ! -s "$CALL_LOG" ]
}

@test "settings.json exists but has no worktree.autoPrune key: skips (never invokes prune)" {
  _install_fake_prune
  printf '{}\n' >"$TMP/.claude/settings.json"
  run_hook
  [ "$status" -eq 0 ]
  [ ! -s "$CALL_LOG" ]
}
