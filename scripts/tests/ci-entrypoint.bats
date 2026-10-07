#!/usr/bin/env bats
# Tests for scripts/ci.sh: the argument handling and the kcov platform guard.
# The heavy targets (shellcheck, pytest, kcov itself) are exercised by CI
# running them; here external tools are shimmed so nothing real runs.

load helpers

ci() {
  run bash "$REPO_ROOT/scripts/ci.sh" "$@"
}

# Put a shim `uname` (reports Darwin) and a failing `kcov` first on PATH.
shim() {
  SHIMS="$BATS_TEST_TMPDIR/shims"
  mkdir -p "$SHIMS"
  printf '#!/bin/sh\necho Darwin\n' >"$SHIMS/uname"
  printf '#!/bin/sh\necho KCOV-RAN\nexit 1\n' >"$SHIMS/kcov"
  chmod +x "$SHIMS/uname" "$SHIMS/kcov"
  export PATH="$SHIMS:$PATH"
}

@test "--help prints usage and exits 0" {
  ci --help
  assert_success
  assert_output_contains "Usage: scripts/ci.sh"
}

@test "no argument is a usage error" {
  ci
  [ "$status" -eq 2 ]
}

@test "unknown target exits 2 and names it" {
  ci no-such-target
  [ "$status" -eq 2 ]
  assert_output_contains "unknown target 'no-such-target'"
}

@test "coverage skips with exit 0 off Linux outside CI" {
  shim
  unset CI
  ci coverage
  assert_success
  assert_output_contains "coverage: skipped"
  [[ "$output" != *KCOV-RAN* ]]
}

@test "coverage does not skip under CI, even off Linux" {
  shim
  export CI=true
  ci coverage
  assert_failure
  assert_output_contains "KCOV-RAN"
}
