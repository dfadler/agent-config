#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# check-worktree-symlinks-hook.sh — the SessionStart hook that runs
# verify-worktree-symlinks.sh --fix and echoes its combined output (prefixed
# with a 🔗 marker) only when non-empty, never failing the session regardless
# of what the underlying check finds.
#
# Hermetic: the REAL hook script is copied into a throwaway directory
# alongside a FAKE verify-worktree-symlinks.sh that logs its argv to CALL_LOG
# and prints controllable output — the hook locates its sibling via
# $(dirname "$0"), so copying both into one directory is enough to substitute
# the fake without touching any real symlink, git repo, or `jq` dependency.

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/check-worktree-symlinks-hook.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/check-worktree-symlinks-hook.sh"
  SCRIPT_UNDER_TEST="$TMP/check-worktree-symlinks-hook.sh"
  CALL_LOG="$TMP/calls.log"
  : >"$CALL_LOG"
  export CALL_LOG
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

_install_fake_verify() {
  cat >"$TMP/verify-worktree-symlinks.sh" <<'EOF'
#!/usr/bin/env bash
echo "verify called: $*" >>"$CALL_LOG"
if [ -n "${FAKE_OUTPUT:-}" ]; then
  echo "$FAKE_OUTPUT"
fi
[ -n "${FAKE_EXIT:-}" ] && exit "$FAKE_EXIT"
exit 0
EOF
  chmod +x "$TMP/verify-worktree-symlinks.sh"
}

run_hook() {
  run env -u CLAUDE_CODE_REMOTE "$@" /bin/bash "$SCRIPT_UNDER_TEST"
}

@test "remote: exits 0 immediately, never invokes the verify script" {
  _install_fake_verify
  run env CLAUDE_CODE_REMOTE=true /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  [ ! -s "$CALL_LOG" ]
  [ -z "$output" ]
}

@test "verify script missing: exits 0 with no output, no crash" {
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "verify script runs with --fix" {
  _install_fake_verify
  run_hook
  [ "$status" -eq 0 ]
  grep -q -- "--fix" "$CALL_LOG"
}

@test "verify script prints nothing: the hook stays silent" {
  _install_fake_verify
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "verify script prints a mismatch: the hook echoes it with the 🔗 prefix" {
  _install_fake_verify
  run_hook FAKE_OUTPUT="node_modules resolves to a stale worktree"
  [ "$status" -eq 0 ]
  [[ "$output" == "🔗"*"node_modules resolves to a stale worktree"* ]]
}

@test "a failing verify script (mismatch not fixed) is swallowed — the hook still exits 0" {
  _install_fake_verify
  run_hook FAKE_OUTPUT="could not relink node_modules" FAKE_EXIT=1
  [ "$status" -eq 0 ]
  [[ "$output" == *"could not relink node_modules"* ]]
}
