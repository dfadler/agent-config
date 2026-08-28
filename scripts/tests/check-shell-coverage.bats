#!/usr/bin/env bats
# Unit tests for scripts/check-shell-coverage.sh
#
# The gate itself has to be trustworthy before the number it prints means
# anything: a coverage check that fails OPEN (missing file, unparseable JSON,
# a non-numeric threshold silently comparing as zero) is worse than no check,
# because it reports success forever. Every failure mode below is therefore
# asserted to EXIT NON-ZERO, not merely to print something.

load helpers

setup() {
  COV_JSON="$BATS_TEST_TMPDIR/coverage.json"
}

check() {
  run bash "$REPO_ROOT/scripts/check-shell-coverage.sh" "$@"
}

# Write a kcov-shaped coverage.json. kcov emits `percent_covered` as a STRING,
# so the fixture does too — a fixture using a bare number would let a
# string-only bug through.
write_coverage() {
  printf '{"percent_covered": "%s", "covered_lines": 12, "total_lines": 40}\n' "$1" > "$COV_JSON"
}

@test "passes when coverage is above the threshold" {
  write_coverage "42.31"
  check "$COV_JSON" 40
  assert_success
  assert_output_contains "Shell script coverage: 42.31%"
  assert_output_contains "meets the 40% baseline"
}

@test "fails when coverage is below the threshold" {
  write_coverage "38.90"
  check "$COV_JSON" 40
  assert_failure
  assert_output_contains "Coverage 38.90% is below the 40% minimum threshold"
}

@test "passes when coverage exactly equals the threshold" {
  write_coverage "40.00"
  check "$COV_JSON" 40
  assert_success
}

# A string comparison would rank "9.50" above "10" and pass; only a numeric
# comparison fails this.
@test "compares numerically, not lexically" {
  write_coverage "9.50"
  check "$COV_JSON" 10
  assert_failure
  assert_output_contains "is below the 10% minimum threshold"
}

# The mirror of the case above: lexically "100.00" < "40", so a string
# comparison would REJECT full coverage.
@test "accepts 100% against a two-digit threshold" {
  write_coverage "100.00"
  check "$COV_JSON" 40
  assert_success
}

@test "fails when the coverage file does not exist" {
  check "$BATS_TEST_TMPDIR/absent.json" 40
  assert_failure
  assert_output_contains "coverage file not found"
}

@test "fails when no threshold argument is given" {
  write_coverage "99.00"
  check "$COV_JSON"
  assert_failure
  assert_output_contains "usage:"
  refute_output_contains "Shell script coverage"
}

# An unexpanded make variable, a typo, or an empty CI expression must not be
# treated as 0 (which would pass anything).
@test "fails when the threshold is not numeric" {
  write_coverage "12.00"
  check "$COV_JSON" '$(COVERAGE_MIN)'
  assert_failure
  assert_output_contains "threshold value is not numeric"
}

@test "fails when the threshold is negative" {
  write_coverage "12.00"
  check "$COV_JSON" -5
  assert_failure
  assert_output_contains "threshold value is not numeric"
}

# A missing jq must be reported as a missing TOOL, not misread as unparseable
# coverage data — the two have very different fixes.
@test "fails with a clear message when jq is not on PATH" {
  write_coverage "99.00"
  mkdir -p "$BATS_TEST_TMPDIR/nobin"
  # bash is resolved BEFORE PATH is emptied — the point is to hide jq, not to
  # make the interpreter itself unfindable.
  local bash_bin
  bash_bin="$(command -v bash)"
  run env PATH="$BATS_TEST_TMPDIR/nobin" \
    "$bash_bin" "$REPO_ROOT/scripts/check-shell-coverage.sh" "$COV_JSON" 40
  assert_failure
  assert_output_contains "jq is required"
}

@test "fails when percent_covered is not numeric" {
  printf '{"percent_covered": "n/a"}\n' > "$COV_JSON"
  check "$COV_JSON" 40
  assert_failure
  assert_output_contains "coverage value is not numeric"
}

@test "fails when percent_covered is absent" {
  printf '{"covered_lines": 12, "total_lines": 40}\n' > "$COV_JSON"
  check "$COV_JSON" 40
  assert_failure
  assert_output_contains "could not read coverage data"
}

@test "fails when the coverage file is not valid JSON" {
  printf 'not json at all\n' > "$COV_JSON"
  check "$COV_JSON" 40
  assert_failure
  assert_output_contains "could not read coverage data"
}

# kcov's own top-level summary is what the gate must read — the per-file
# entries under .files carry their own percent_covered, and picking one of
# those (a `grep`-first-match implementation, say) would report a wildly
# different number.
@test "-h prints usage and exits 0" {
  check -h
  assert_success
  assert_output_contains "Usage: check-shell-coverage.sh"
}

@test "--help prints usage and exits 0, even with no other args" {
  check --help
  assert_success
  assert_output_contains "Usage: check-shell-coverage.sh"
}

@test "exits with EXIT_USAGE (2) when no threshold argument is given" {
  write_coverage "99.00"
  check "$COV_JSON"
  assert_status 2
}

@test "exits with EXIT_USAGE (2) when the coverage file does not exist" {
  check "$BATS_TEST_TMPDIR/absent.json" 40
  assert_status 2
}

@test "exits with EXIT_USAGE (2) when the threshold is not numeric" {
  write_coverage "12.00"
  check "$COV_JSON" '$(COVERAGE_MIN)'
  assert_status 2
}

@test "exits with EXIT_DEPENDENCY (4) when jq is not on PATH" {
  write_coverage "99.00"
  mkdir -p "$BATS_TEST_TMPDIR/nobin"
  local bash_bin
  bash_bin="$(command -v bash)"
  run env PATH="$BATS_TEST_TMPDIR/nobin" \
    "$bash_bin" "$REPO_ROOT/scripts/check-shell-coverage.sh" "$COV_JSON" 40
  assert_status 4
}

@test "exits with EXIT_INTERNAL (20) when percent_covered is not numeric" {
  printf '{"percent_covered": "n/a"}\n' > "$COV_JSON"
  check "$COV_JSON" 40
  assert_status 20
}

@test "exits with EXIT_INTERNAL (20) when percent_covered is absent" {
  printf '{"covered_lines": 12, "total_lines": 40}\n' > "$COV_JSON"
  check "$COV_JSON" 40
  assert_status 20
}

@test "exits with EXIT_FAILURE (1) when coverage is below the threshold" {
  write_coverage "38.90"
  check "$COV_JSON" 40
  assert_status 1
}

@test "reads the top-level percent_covered, not a per-file one" {
  cat > "$COV_JSON" <<'EOF'
{
  "percent_covered": "38.00",
  "files": [
    {"file": "/repo/scripts/a.sh", "percent_covered": "95.00"},
    {"file": "/repo/scripts/b.sh", "percent_covered": "99.00"}
  ]
}
EOF
  check "$COV_JSON" 40
  assert_failure
  assert_output_contains "Coverage 38.00% is below"
}
