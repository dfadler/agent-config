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
  assert_output_contains "All shell scripts are chmod +x"
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


# --- sourced-only exemption (#168: a missing shebang alone is not proof a
# file is sourced-only — it can still be run via `bash file.sh` or a
# wrapper, so it's checked like any other file unless it carries the
# explicit `# sourced-only` marker) -------------------------------------

@test "a file with no shebang and no sourced-only marker is NOT exempt: it must still declare set -uo pipefail" {
  printf '# a library, maybe sourced, maybe not\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  check
  assert_failure
  assert_output_contains "lib.sh"
  assert_output_contains "Missing 'set -uo pipefail'"
  # No shebang means the executable-bit check never applies to it.
  refute_output_contains "not marked executable"
}

@test "a file with no shebang passes when set -uo pipefail is its first real statement" {
  printf '# a library\nset -uo pipefail\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  check
  assert_success
}

@test "the '# sourced-only' marker exempts a no-shebang file from the set-flags check" {
  printf '# sourced-only\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  check
  assert_success
}

@test "the '# sourced-only' marker exempts a shebang'd, non-executable file with no set flags" {
  printf '#!/bin/bash\n# sourced-only\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  # Deliberately no chmod +x and no set -uo pipefail — both checks should be
  # skipped once the file is explicitly declared sourced-only.
  check
  assert_success
}

@test "a '# sourced-only' marker placed after the first real statement does not count" {
  printf '#!/bin/bash\necho hi\n# sourced-only\n' > "$FIXTURE_DIR/late-marker.sh"
  chmod +x "$FIXTURE_DIR/late-marker.sh"
  check
  assert_failure
  assert_output_contains "late-marker.sh"
}

@test "a near-miss marker ('#sourced-only', no space) does not grant the exemption" {
  printf '#sourced-only\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/near-miss.sh"
  check
  assert_failure
  assert_output_contains "near-miss.sh"
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

@test "a no-shebang file is never checked for the executable bit, marker or not" {
  # Deliberately no chmod +x, and no set -uo pipefail either — this should
  # fail on the set-flags check (no marker, no shebang) but never even
  # mention the executable-bit check, which only applies to shebang'd files.
  printf '# a library\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  check
  assert_failure
  refute_output_contains "not marked executable"
}

@test "a marked sourced-only, no-shebang file is exempt from the executable-bit check too" {
  printf '# sourced-only\nhelper() { echo hi; }\n' > "$FIXTURE_DIR/lib.sh"
  # Deliberately no chmod +x — a sourced-only library is never run directly.
  check
  assert_success
  refute_output_contains "not marked executable"
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
