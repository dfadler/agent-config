#!/usr/bin/env bats
# Unit tests for scripts/diy-dashboard-prototype.sh
#
# The script under test calls the real `gh` CLI against live GitHub repos, so
# these tests never invoke real `gh` — per this repo's hermetic-test
# convention, `gh` is shimmed via PATH with a fixture that returns canned
# JSON matching the exact `--json` field sets the script requests. `jq` is
# left real (a pure, no-network local tool), matching how helpers.bash treats
# tools like that elsewhere in this suite.

load helpers

SCRIPT="$REPO_ROOT/scripts/diy-dashboard-prototype.sh"

setup() {
  make_sandbox
  OUT_FILE="$BATS_TEST_TMPDIR/dashboard.html"
}

teardown() {
  destroy_sandbox
}

# Installs a fixture `gh` ahead of the sandbox's network-blocking shim so the
# full fetch path can be exercised without touching the network. Covers the
# three subcommands the script actually calls: `pr list`, `run list`,
# `issue list`.
install_gh_fixture() {
  FIXTURE_BIN="$BATS_TEST_TMPDIR/fixture-bin"
  mkdir -p "$FIXTURE_BIN"
  cat >"$FIXTURE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr list")
    echo "2"
    ;;
  "run list")
    cat <<'JSON'
[{"displayTitle":"Fix thing","status":"completed","conclusion":"success","workflowName":"CI","createdAt":"2026-01-01T00:00:00Z"}]
JSON
    ;;
  "issue list")
    cat <<'JSON'
[
  {"number": 10, "title": "An open issue", "state": "OPEN", "updatedAt": "2026-01-02T00:00:00Z"},
  {"number": 9, "title": "A closed issue", "state": "CLOSED", "updatedAt": "2026-01-01T00:00:00Z"}
]
JSON
    ;;
  *)
    echo "unexpected gh invocation: $*" >&2
    exit 99
    ;;
esac
EOF
  chmod +x "$FIXTURE_BIN/gh"
  PATH="$FIXTURE_BIN:$PATH"
}

@test "-h prints usage and exits 0" {
  run bash "$SCRIPT" -h
  assert_success
  assert_output_contains "Usage: diy-dashboard-prototype.sh"
}

@test "--help prints usage and exits 0" {
  run bash "$SCRIPT" --help
  assert_success
  assert_output_contains "Usage: diy-dashboard-prototype.sh"
}

@test "an unrecognized option exits with EXIT_USAGE (2)" {
  run bash "$SCRIPT" --bogus
  assert_status 2
  assert_output_contains "Unknown option: --bogus"
}

@test "-o with no value exits with EXIT_USAGE (2)" {
  run bash "$SCRIPT" -o
  assert_status 2
}

@test "exits with EXIT_DEPENDENCY (4) when gh is not on PATH" {
  local no_gh_path="$BATS_TEST_TMPDIR/no-gh-path"
  mkdir -p "$no_gh_path"
  ln -s "$(command -v jq)" "$no_gh_path/jq"
  ln -s "$(command -v bash)" "$no_gh_path/bash"
  PATH="$no_gh_path" run bash "$SCRIPT" -o "$OUT_FILE" dfadler/example
  assert_status 4
  assert_output_contains "gh"
}

@test "renders a dashboard from fixture gh data, including lowercase badge classes" {
  install_gh_fixture
  run bash "$SCRIPT" -o "$OUT_FILE" dfadler/example
  assert_success
  [ -f "$OUT_FILE" ]

  run cat "$OUT_FILE"
  assert_output_contains "dfadler/example"
  assert_output_contains "<span class=\"stat-value\">2</span>"
  assert_output_contains "open PRs"
  assert_output_contains "stat-value stat-ok\">success</span>"
  # Regression check: gh's issue state is uppercase (OPEN/CLOSED) but the
  # page's CSS defines lowercase badge-open/badge-closed classes. A naive
  # interpolation of the raw state into the class name silently produces an
  # unstyled badge-OPEN/badge-CLOSED that never matches any CSS rule.
  assert_output_contains "badge badge-open"
  assert_output_contains "badge badge-closed"
  refute_output_contains "badge-OPEN"
  refute_output_contains "badge-CLOSED"
  # The visible label text still preserves the original casing.
  assert_output_contains ">OPEN</span>"
  assert_output_contains ">CLOSED</span>"
  # Regression check: each issue title must be a clickable link to the real
  # issue on GitHub, not plain text.
  assert_output_contains "<a href=\"https://github.com/dfadler/example/issues/10\">#10 An open issue</a>"
  assert_output_contains "<a href=\"https://github.com/dfadler/example/issues/9\">#9 A closed issue</a>"
}

@test "escapes quote characters in titles so they cannot break out of href attributes" {
  FIXTURE_BIN="$BATS_TEST_TMPDIR/fixture-bin-quotes"
  mkdir -p "$FIXTURE_BIN"
  cat >"$FIXTURE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr list") echo "0" ;;
  "run list") echo "[]" ;;
  "issue list")
    cat <<'JSON'
[{"number": 1, "title": "a\" onmouseover=\"alert(1)", "state": "OPEN", "updatedAt": "2026-01-01T00:00:00Z"}]
JSON
    ;;
  *) exit 99 ;;
esac
EOF
  chmod +x "$FIXTURE_BIN/gh"
  # Regression check (CWE-79): a crafted issue title containing a double
  # quote must not be able to break out of the <a href="..."> attribute it's
  # rendered inside. Before html_escape covered quote characters, this title
  # would have injected a live onmouseover handler into the page.
  PATH="$FIXTURE_BIN:$PATH" run bash "$SCRIPT" -o "$OUT_FILE" dfadler/quote-example
  assert_success

  run cat "$OUT_FILE"
  refute_output_contains 'onmouseover="alert(1)"'
  assert_output_contains "a&quot; onmouseover=&quot;alert(1)"
}

@test "shows an error state, not empty data, when gh run/issue list fail" {
  FIXTURE_BIN="$BATS_TEST_TMPDIR/fixture-bin-gh-failure"
  mkdir -p "$FIXTURE_BIN"
  cat >"$FIXTURE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr list") echo "0" ;;
  "run list") echo "authentication failed" >&2; exit 1 ;;
  "issue list") echo "authentication failed" >&2; exit 1 ;;
  *) exit 99 ;;
esac
EOF
  chmod +x "$FIXTURE_BIN/gh"
  # Regression check: a nonzero `gh` exit (expired token, API error, bad
  # repo) must render as a distinct error state, never silently collapse
  # into the same "no workflow runs found" / "No issues found." text a
  # genuinely-empty, successful fetch would produce — those two situations
  # are not the same thing and must not look identical on the page.
  PATH="$FIXTURE_BIN:$PATH" run bash "$SCRIPT" -o "$OUT_FILE" dfadler/broken-example
  assert_success

  run cat "$OUT_FILE"
  assert_output_contains "error fetching runs"
  assert_output_contains "Could not fetch issues"
  refute_output_contains "no workflow runs found"
  refute_output_contains "No issues found."
}

@test "handles a repo with no workflow runs and no issues" {
  FIXTURE_BIN="$BATS_TEST_TMPDIR/fixture-bin-empty"
  mkdir -p "$FIXTURE_BIN"
  cat >"$FIXTURE_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  "pr list") echo "0" ;;
  "run list") echo "[]" ;;
  "issue list") echo "[]" ;;
  *) exit 99 ;;
esac
EOF
  chmod +x "$FIXTURE_BIN/gh"
  PATH="$FIXTURE_BIN:$PATH" run bash "$SCRIPT" -o "$OUT_FILE" dfadler/empty-example
  assert_success

  run cat "$OUT_FILE"
  assert_output_contains "no workflow runs found"
  assert_output_contains "No issues found."
}
