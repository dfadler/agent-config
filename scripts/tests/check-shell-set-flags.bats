#!/usr/bin/env bats
# Unit tests for scripts/check-shell-set-flags.sh

load helpers

setup() {
  FIXTURE_DIR="$BATS_TEST_TMPDIR/fixture-scripts"
  mkdir -p "$FIXTURE_DIR"
}

check() {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh" "$FIXTURE_DIR"
}

@test "passes on a directory with no scripts" {
  check
  assert_success
  assert_output_contains "All executable shell scripts are chmod +x and declare"
}

@test "passes when set -uo pipefail is the first statement" {
  printf '#!/bin/bash\nset -uo pipefail\n\necho hi\n' > "$FIXTURE_DIR/ok.sh"
  chmod +x "$FIXTURE_DIR/ok.sh"
  check
  assert_success
}

@test "passes when set -euo pipefail is the first statement" {
  printf '#!/bin/bash\nset -euo pipefail\n\necho hi\n' > "$FIXTURE_DIR/ok.sh"
  chmod +x "$FIXTURE_DIR/ok.sh"
  check
  assert_success
}

@test "passes when a long header comment precedes the set line" {
  {
    echo '#!/bin/bash'
    echo '#'
    for _ in $(seq 1 20); do echo '# more rationale...'; done
    echo 'set -euo pipefail'
    echo 'echo hi'
  } > "$FIXTURE_DIR/long-header.sh"
  chmod +x "$FIXTURE_DIR/long-header.sh"
  check
  assert_success
}

@test "fails when a shebanged script has no set flags at all" {
  printf '#!/bin/bash\n\necho hi\n' > "$FIXTURE_DIR/missing.sh"
  chmod +x "$FIXTURE_DIR/missing.sh"
  check
  assert_failure
  assert_output_contains "missing.sh"
  # Isolate this to the set-flags violation, not also an exec-bit one.
  refute_output_contains "not marked executable"
}

@test "fails when set appears after a real statement" {
  printf '#!/bin/bash\necho hi\nset -euo pipefail\n' > "$FIXTURE_DIR/late.sh"
  chmod +x "$FIXTURE_DIR/late.sh"
  check
  assert_failure
}

# The whole reason the regex checks the flag cluster rather than substring
# matching "pipefail": without -o, the word is an unused positional parameter
# and pipefail is never actually enabled.
@test "fails on 'set -eu pipefail' — no -o, so pipefail never takes effect" {
  printf '#!/bin/bash\nset -eu pipefail\necho hi\n' > "$FIXTURE_DIR/no-o.sh"
  chmod +x "$FIXTURE_DIR/no-o.sh"
  check
  assert_failure
  assert_output_contains "no-o.sh"
}

@test "fails on 'set -eo pipefail' — no -u" {
  printf '#!/bin/bash\nset -eo pipefail\necho hi\n' > "$FIXTURE_DIR/no-u.sh"
  chmod +x "$FIXTURE_DIR/no-u.sh"
  check
  assert_failure
}

@test "skips a file with no shebang (sourced-only libraries are exempt)" {
  printf '# a sourced library\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  check
  assert_success
}

@test "reports every offender, not just the first" {
  printf '#!/bin/bash\necho a\n' > "$FIXTURE_DIR/one.sh"
  printf '#!/bin/bash\necho b\n' > "$FIXTURE_DIR/two.sh"
  chmod +x "$FIXTURE_DIR/one.sh" "$FIXTURE_DIR/two.sh"
  check
  assert_failure
  assert_output_contains "one.sh"
  assert_output_contains "two.sh"
}

# --- executable-bit check (#150's follow-up: a script can pass every other
# check here, be reviewed and merged, and still be dead on arrival if the
# one thing that actually runs it needs the OS execute bit) ------------------

@test "fails when a shebanged script is not marked executable" {
  printf '#!/bin/bash\nset -uo pipefail\necho hi\n' > "$FIXTURE_DIR/not-exec.sh"
  # Deliberately no chmod +x.
  check
  assert_failure
  assert_output_contains "not marked executable"
  assert_output_contains "not-exec.sh"
  # Isolate this to the exec-bit violation, not also a set-flags one.
  refute_output_contains "Missing 'set -uo pipefail'"
}

@test "reports both violation types independently when a script has neither" {
  printf '#!/bin/bash\necho hi\n' > "$FIXTURE_DIR/broken.sh"
  # Deliberately no chmod +x, and no set -uo pipefail either.
  check
  assert_failure
  assert_output_contains "not marked executable"
  assert_output_contains "Missing 'set -uo pipefail'"
  # The filename appears under BOTH headers, since it violates both checks.
  local count
  count="$(printf '%s\n' "$output" | grep -c 'broken\.sh')"
  [ "$count" -eq 2 ]
}

@test "a file with no shebang is exempt from the executable-bit check too" {
  printf '# a sourced library\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  # Deliberately no chmod +x — sourced-only libraries are never run directly.
  check
  assert_success
}

@test "the repo's own scripts satisfy the convention" {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh"
  assert_success
}

@test "-h prints usage and exits 0" {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh" -h
  assert_success
  assert_output_contains "Usage: check-shell-set-flags.sh"
}

@test "--help prints usage and exits 0, even with other args present" {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh" --help "$FIXTURE_DIR"
  assert_success
  assert_output_contains "Usage: check-shell-set-flags.sh"
}

@test "an unrecognized option exits with EXIT_USAGE (2)" {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh" --bogus
  assert_status 2
  assert_output_contains "Unknown option: --bogus"
}

@test "a violation exits with EXIT_FAILURE (1)" {
  printf '#!/bin/bash\n\necho hi\n' > "$FIXTURE_DIR/missing.sh"
  check
  assert_status 1
}
