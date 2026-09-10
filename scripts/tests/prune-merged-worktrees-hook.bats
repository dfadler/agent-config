#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# prune-merged-worktrees-hook.sh — the SessionStart hook that runs
# prune-merged-worktrees.sh in --auto (default) or --hook (WORKTREE_AUTO_PRUNE
# opt-out) mode and never fails the session.
#
# Hermetic: the REAL hook script is copied into a throwaway directory
# alongside a FAKE prune-merged-worktrees.sh that logs its argv to CALL_LOG
# and prints controllable stdout/stderr — the hook locates its sibling via
# $(dirname "$0"), so copying both into one directory is enough to substitute
# the fake without touching any real git, worktree, or network.

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/prune-merged-worktrees-hook.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/prune-merged-worktrees-hook.sh"
  SCRIPT_UNDER_TEST="$TMP/prune-merged-worktrees-hook.sh"
  CALL_LOG="$TMP/calls.log"
  : >"$CALL_LOG"
  export CALL_LOG
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

# run_hook [env=val ...] — run the real hook.
run_hook() {
  run env -u WORKTREE_AUTO_PRUNE -u CLAUDE_CODE_REMOTE "$@" /bin/bash "$SCRIPT_UNDER_TEST"
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

@test "default (WORKTREE_AUTO_PRUNE unset): invokes prune in --auto mode" {
  _install_fake_prune
  run_hook
  [ "$status" -eq 0 ]
  grep -q -- "--auto" "$CALL_LOG"
  ! grep -q -- "--hook" "$CALL_LOG"
}

@test "WORKTREE_AUTO_PRUNE=0 opts out: invokes prune in --hook mode" {
  _install_fake_prune
  run env WORKTREE_AUTO_PRUNE=0 /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  grep -q -- "--hook" "$CALL_LOG"
}

@test "WORKTREE_AUTO_PRUNE=false/no/off all opt out to --hook mode" {
  _install_fake_prune
  for val in false no off; do
    : >"$CALL_LOG"
    run env WORKTREE_AUTO_PRUNE="$val" /bin/bash "$SCRIPT_UNDER_TEST"
    [ "$status" -eq 0 ]
    grep -q -- "--hook" "$CALL_LOG"
  done
}

@test "WORKTREE_AUTO_PRUNE=1 (or any non-opt-out value) stays in --auto mode" {
  _install_fake_prune
  run env WORKTREE_AUTO_PRUNE=1 /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  grep -q -- "--auto" "$CALL_LOG"
}

@test "prune script's stdout passes through the hook" {
  _install_fake_prune
  run_hook FAKE_STDOUT="removed 2 merged worktrees"
  [ "$status" -eq 0 ]
  [[ "$output" == *"removed 2 merged worktrees"* ]]
}

@test "prune script's stderr is suppressed" {
  _install_fake_prune
  run_hook FAKE_STDERR="a warning nobody should see"
  [ "$status" -eq 0 ]
  [[ "$output" != *"a warning nobody should see"* ]]
}

@test "a failing prune script is swallowed — the hook still exits 0" {
  _install_fake_prune
  run_hook FAKE_EXIT=1
  [ "$status" -eq 0 ]
  [ -s "$CALL_LOG" ]
}
