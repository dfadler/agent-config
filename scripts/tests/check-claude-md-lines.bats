#!/usr/bin/env bats
# Unit tests for scripts/check-claude-md-lines.sh

load helpers

setup() {
  FIXTURE="$BATS_TEST_TMPDIR/CLAUDE.md"
}

check() {
  run bash "$REPO_ROOT/scripts/check-claude-md-lines.sh" "$@"
}

write_lines() {
  local n="$1"
  : > "$FIXTURE"
  local i
  for ((i = 0; i < n; i++)); do echo "line $i" >> "$FIXTURE"; done
}

@test "passes when the file is under the ceiling" {
  write_lines 10
  check "$FIXTURE" 20
  assert_success
  assert_output_contains "is 10 lines (ceiling: 20)"
}

@test "passes when the file exactly equals the ceiling" {
  write_lines 20
  check "$FIXTURE" 20
  assert_success
}

@test "fails when the file is over the ceiling" {
  write_lines 21
  check "$FIXTURE" 20
  assert_failure
  assert_output_contains "is 21 lines, over the 20-line ceiling"
}

@test "fails when the file does not exist" {
  check "$BATS_TEST_TMPDIR/absent.md" 20
  assert_failure
  assert_output_contains "file not found"
}

@test "fails when no max-lines argument is given" {
  write_lines 10
  check "$FIXTURE"
  assert_failure
  assert_output_contains "usage:"
}

# An unexpanded make variable or a typo must not be treated as 0 (which would
# fail everything) or silently pass.
@test "fails when max-lines is not numeric" {
  write_lines 10
  check "$FIXTURE" '$(CLAUDE_MD_MAX_LINES)'
  assert_failure
  assert_output_contains "max-lines value is not a non-negative integer"
}

@test "fails when max-lines is negative" {
  write_lines 10
  check "$FIXTURE" -5
  assert_failure
  assert_output_contains "max-lines value is not a non-negative integer"
}

@test "the repo's own claude/CLAUDE.md satisfies the current ceiling" {
  # Read CLAUDE_MD_MAX_LINES from the Makefile rather than hardcoding it here,
  # so a threshold bump there can't silently leave this test checking a stale
  # value.
  local max_lines
  max_lines="$(sed -nE 's/^CLAUDE_MD_MAX_LINES[[:space:]]*:=[[:space:]]*([0-9]+).*/\1/p' "$REPO_ROOT/Makefile")"
  [ -n "$max_lines" ]
  run bash "$REPO_ROOT/scripts/check-claude-md-lines.sh" "$REPO_ROOT/claude/CLAUDE.md" "$max_lines"
  assert_success
}

@test "-h prints usage and exits 0" {
  check -h
  assert_success
  assert_output_contains "Usage: check-claude-md-lines.sh"
}

@test "--help prints usage and exits 0, even with no other args" {
  check --help
  assert_success
  assert_output_contains "Usage: check-claude-md-lines.sh"
}

@test "exits with EXIT_USAGE (2) when no max-lines argument is given" {
  write_lines 10
  check "$FIXTURE"
  assert_status 2
}

@test "exits with EXIT_USAGE (2) when the file does not exist" {
  check "$BATS_TEST_TMPDIR/absent.md" 20
  assert_status 2
}

@test "exits with EXIT_USAGE (2) when max-lines is not numeric" {
  write_lines 10
  check "$FIXTURE" '$(CLAUDE_MD_MAX_LINES)'
  assert_status 2
}

@test "exits with EXIT_FAILURE (1) when the file is over the ceiling" {
  write_lines 21
  check "$FIXTURE" 20
  assert_status 1
}
