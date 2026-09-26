#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/hooks/scripts/memory-hygiene-stop-hook.sh
# — the Stop hook that reminds Claude to write a memory update when a turn
# ends with uncommitted git changes and nobody has opted out.
#
# Hermetic: the real hook script is copied into a throwaway directory. A real
# (disposable) git repo under a tmp dir stands in for "the project" — no fake
# git shim needed, since the script's only git usage is
# `rev-parse --is-inside-work-tree` and `status --porcelain`, both cheap and
# safe to run for real against a scratch repo. Nothing touches this repo's
# own working tree or its `TMPDIR`-based marker directory outside the test's
# own isolated `TMPDIR`.

bats_require_minimum_version 1.5.0 # for `run --separate-stderr`

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/hooks/scripts/memory-hygiene-stop-hook.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/memory-hygiene-stop-hook.sh"
  SCRIPT_UNDER_TEST="$TMP/memory-hygiene-stop-hook.sh"

  # Isolate the hook's own marker directory (it's keyed off $TMPDIR) so a
  # real fire in one test can never leak into another, or into a real
  # session's marker on the machine actually running this suite.
  export TMPDIR="$TMP/tmpdir"
  mkdir -p "$TMPDIR"

  REPO="$TMP/repo"
  mkdir -p "$REPO"
  git -C "$REPO" init -q
  git -C "$REPO" config user.email "test@example.com"
  git -C "$REPO" config user.name "Test"

  unset MEMORY_HYGIENE_REMINDER
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

# Runs the hook with $1 as its JSON stdin, honoring whatever env vars the
# calling test already exported (e.g. MEMORY_HYGIENE_REMINDER, PATH).
run_hook() {
  run bash -c 'printf "%s" "$1" | bash "$2"' bash "$1" "$SCRIPT_UNDER_TEST"
}

_dirty_repo_json() {
  touch "$REPO/untracked-file"
  printf '{"cwd":"%s","session_id":"%s","stop_hook_active":false}' "$REPO" "${1:-session-a}"
}

_clean_repo_json() {
  printf '{"cwd":"%s","session_id":"%s","stop_hook_active":false}' "$REPO" "${1:-session-a}"
}

@test "off by default: dirty repo, MEMORY_HYGIENE_REMINDER unset, still exits 0 with no output" {
  json="$(_dirty_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "explicitly off: MEMORY_HYGIENE_REMINDER=false is treated as off" {
  export MEMORY_HYGIENE_REMINDER=false
  json="$(_dirty_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "opted in, dirty repo, first fire: prints the reminder and creates a marker" {
  export MEMORY_HYGIENE_REMINDER=on
  json="$(_dirty_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"hookEventName": "Stop"'* ]]
  [[ "$output" == *'"decision": "block"'* ]]
  [[ "$output" == *"memory-hygiene.md"* ]]
  [ -e "$TMPDIR/agent-config-memory-hygiene/session-a" ]
}

@test "opted in with '1' instead of 'on' also fires" {
  export MEMORY_HYGIENE_REMINDER=1
  json="$(_dirty_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision": "block"'* ]]
}

@test "opted in, dirty repo, second call in the same session: throttled to silence" {
  export MEMORY_HYGIENE_REMINDER=on
  json="$(_dirty_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision": "block"'* ]]

  touch "$REPO/another-untracked-file"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "opted in, dirty repo, different session_id fires independently" {
  export MEMORY_HYGIENE_REMINDER=on
  run_hook "$(_dirty_repo_json session-a)"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision": "block"'* ]]

  run_hook "$(_dirty_repo_json session-b)"
  [ "$status" -eq 0 ]
  [[ "$output" == *'"decision": "block"'* ]]
}

@test "opted in, clean repo: no reminder, no marker written" {
  export MEMORY_HYGIENE_REMINDER=on
  json="$(_clean_repo_json)"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
  [ ! -e "$TMPDIR/agent-config-memory-hygiene/session-a" ]
}

@test "opted in, cwd is not a git repo: exits quietly" {
  export MEMORY_HYGIENE_REMINDER=on
  nongit="$TMP/not-a-repo"
  mkdir -p "$nongit"
  json="$(printf '{"cwd":"%s","session_id":"session-a","stop_hook_active":false}' "$nongit")"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "stop_hook_active=true short-circuits even when opted in with a dirty repo" {
  export MEMORY_HYGIENE_REMINDER=on
  touch "$REPO/untracked-file"
  json="$(printf '{"cwd":"%s","session_id":"session-a","stop_hook_active":true}' "$REPO")"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "missing session_id: exits quietly even when opted in with a dirty repo" {
  export MEMORY_HYGIENE_REMINDER=on
  touch "$REPO/untracked-file"
  json="$(printf '{"cwd":"%s","stop_hook_active":false}' "$REPO")"
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "missing cwd: exits quietly even when opted in" {
  export MEMORY_HYGIENE_REMINDER=on
  json='{"session_id":"session-a","stop_hook_active":false}'
  run_hook "$json"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "jq missing on PATH: exits quietly regardless of opt-in or repo state" {
  export MEMORY_HYGIENE_REMINDER=on
  json="$(_dirty_repo_json)"
  nobin="$TMP/no-jq-bin"
  mkdir -p "$nobin"
  for tool in bash sh cat mkdir printf tr git; do
    real="$(command -v "$tool")"
    [ -n "$real" ] && ln -s "$real" "$nobin/$tool"
  done
  run bash -c 'PATH="$1" bash -c '\''printf "%s" "$1" | bash "$2"'\'' bash "$2" "$3"' \
    bash "$nobin" "$json" "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
