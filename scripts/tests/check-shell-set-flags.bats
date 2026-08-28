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
  assert_output_contains "All executable shell scripts declare"
}

@test "passes when set -uo pipefail is the first statement" {
  printf '#!/bin/bash\nset -uo pipefail\n\necho hi\n' > "$FIXTURE_DIR/ok.sh"
  check
  assert_success
}

@test "passes when set -euo pipefail is the first statement" {
  printf '#!/bin/bash\nset -euo pipefail\n\necho hi\n' > "$FIXTURE_DIR/ok.sh"
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
  check
  assert_success
}

@test "fails when a shebanged script has no set flags at all" {
  printf '#!/bin/bash\n\necho hi\n' > "$FIXTURE_DIR/missing.sh"
  check
  assert_failure
  assert_output_contains "missing.sh"
}

@test "fails when set appears after a real statement" {
  printf '#!/bin/bash\necho hi\nset -euo pipefail\n' > "$FIXTURE_DIR/late.sh"
  check
  assert_failure
}

# The whole reason the regex checks the flag cluster rather than substring
# matching "pipefail": without -o, the word is an unused positional parameter
# and pipefail is never actually enabled.
@test "fails on 'set -eu pipefail' — no -o, so pipefail never takes effect" {
  printf '#!/bin/bash\nset -eu pipefail\necho hi\n' > "$FIXTURE_DIR/no-o.sh"
  check
  assert_failure
  assert_output_contains "no-o.sh"
}

@test "fails on 'set -eo pipefail' — no -u" {
  printf '#!/bin/bash\nset -eo pipefail\necho hi\n' > "$FIXTURE_DIR/no-u.sh"
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
  check
  assert_failure
  assert_output_contains "one.sh"
  assert_output_contains "two.sh"
}

@test "the repo's own scripts satisfy the convention" {
  run bash "$REPO_ROOT/scripts/check-shell-set-flags.sh"
  assert_success
}
