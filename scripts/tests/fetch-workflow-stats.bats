#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/fetch_workflow_stats.sh
#
# The script fetches name, 30-day run count, and timing stats for one or more
# workflow IDs and prints a formatted table.  These tests cover:
#
#   1. Outputs a header + one data row per workflow ID when gh succeeds
#   2. Exits 1 when no workflow IDs are provided
#
# gh and python3 are faked so no real network calls occur.  jq is not needed
# by the tests themselves; the script doesn't call jq directly.

load helpers

STATS_SCRIPT="$REPO_ROOT/plugins/gha-ci-audit/scripts/fetch_workflow_stats.sh"

# ---------------------------------------------------------------------------
# gh shim
# ---------------------------------------------------------------------------
# Handles every gh api call fetch_workflow_stats.sh makes per workflow ID:
#   repos/.../actions/workflows/{id}                  --jq '.name'
#   repos/.../actions/workflows/{id}/runs?per_page=1* --jq '.total_count'
#   repos/.../actions/workflows/{id}/runs?per_page=100 --jq '...' (timing)
shim_gh_stats() {
  cat > "$SHIM_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
url="${2:-}"
if [[ "$url" == */actions/workflows/[0-9]* && "$url" != */runs* ]]; then
  # Workflow name lookup (ends at the workflow ID, no /runs)
  echo "Test Workflow"
elif [[ "$url" == */runs* && "$*" == *"per_page=1"* ]]; then
  # 30-day run count
  echo "25"
elif [[ "$url" == */runs* && "$*" == *"per_page=100"* ]]; then
  # Timing source — empty array is fine; python3 shim handles the rest
  echo "[]"
else
  echo "fake gh: unexpected URL: $url  args: $*" >&2
  exit 3
fi
EOF
  chmod +x "$SHIM_BIN/gh"
}

# ---------------------------------------------------------------------------
# python3 shim
# ---------------------------------------------------------------------------
# Only compute_workflow_timing.py is called by fetch_workflow_stats.sh.
# It reads JSON from stdin and outputs "AVG_MIN P90_MIN".
shim_python3_stats() {
  cat > "$SHIM_BIN/python3" <<'EOF'
#!/usr/bin/env bash
script="$(basename "${1:-}")"
case "$script" in
  compute_workflow_timing.py)
    cat > /dev/null   # consume stdin (the workflow_runs JSON)
    echo "3.5 5.2"
    ;;
  *)
    echo "fake python3: unexpected script: $script  args: $*" >&2
    exit 3
    ;;
esac
EOF
  chmod +x "$SHIM_BIN/python3"
}

# ---------------------------------------------------------------------------
# per-test setup / teardown
# ---------------------------------------------------------------------------

setup() {
  make_sandbox
  shim_gh_stats
  shim_python3_stats
}

teardown() {
  destroy_sandbox
}

stats() {
  run bash "$STATS_SCRIPT" "$@"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@test "prints a header and one data row when called with owner/repo and a workflow ID" {
  stats test/repo 12345
  assert_success
  # Header must be present
  assert_output_contains "WF_ID"
  assert_output_contains "NAME"
  assert_output_contains "RUNS_30D"
  # Data row must carry the workflow ID and the values from the shims
  assert_output_contains "12345"
  assert_output_contains "Test Workflow"
  assert_output_contains "25"
  assert_output_contains "3.5"
  assert_output_contains "5.2"
}

@test "exits 1 when no workflow IDs are provided" {
  stats test/repo
  assert_status 1
  assert_output_contains "provide at least one workflow ID"
}
