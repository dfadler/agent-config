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

# A `claude` that echoes its arguments and exits with $1, so a test can see
# exactly what validate-plugins ran.
claude_shim() {
  SHIMS="$BATS_TEST_TMPDIR/shims"
  mkdir -p "$SHIMS"
  printf '#!/bin/sh\necho "CLAUDE-SHIM $*"\nexit %s\n' "$1" >"$SHIMS/claude"
  chmod +x "$SHIMS/claude"
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
  # The real target does `rm -rf $COVERAGE_DIR`; when this suite itself runs
  # under `ci.sh coverage`, that is the live kcov output dir.
  export COVERAGE_DIR="$BATS_TEST_TMPDIR/cov"
  ci coverage
  assert_failure
  assert_output_contains "KCOV-RAN"
}

@test "validate-plugins runs claude plugin validate --strict and passes" {
  claude_shim 0
  ci validate-plugins
  assert_success
  assert_output_contains "plugins validated"
}

@test "validate-plugins fails and prints the validator output when claude fails" {
  claude_shim 1
  ci validate-plugins
  assert_failure
  assert_output_contains "CLAUDE-SHIM plugin validate"
  assert_output_contains "--strict"
}

@test "validate-plugins skips off CI and fails under CI when claude is missing" {
  # A PATH with the system tools but, on most machines, no claude. Skip where it has one.
  if PATH=/usr/bin:/bin command -v claude >/dev/null 2>&1; then
    skip "claude is in /usr/bin or /bin"
  fi
  unset CI
  run env PATH=/usr/bin:/bin bash "$REPO_ROOT/scripts/ci.sh" validate-plugins
  assert_success
  assert_output_contains "skipped"
  run env CI=true PATH=/usr/bin:/bin bash "$REPO_ROOT/scripts/ci.sh" validate-plugins
  assert_failure
  assert_output_contains "claude CLI not found"
}
