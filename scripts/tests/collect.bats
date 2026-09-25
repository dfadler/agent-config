#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/collect.sh
#
# collect.sh orchestrates 8 gh api calls and 5 python3 invocations to produce
# the raw data for one eval run. These tests cover the four key behaviours:
#
#   1. Happy path with --workflow-id: exits 0, creates all expected output files
#   2. Ambiguous detection (no --workflow-id): exits 2 and writes candidates JSON
#   3. gh api failure: exits non-zero (set -euo pipefail propagates the error)
#   4. --output-dir creation: the directory is created if it does not yet exist
#
# gh and python3 are faked (overriding helpers.bash's hard-blocking shim for gh)
# so no real network call or file-system write outside the sandbox ever happens.
# jq is left as the real system binary — it runs only on fixture data.

load helpers

COLLECT_SCRIPT="$REPO_ROOT/plugins/gha-ci-audit/scripts/collect.sh"

# ---------------------------------------------------------------------------
# gh shim
# ---------------------------------------------------------------------------
# Handles every gh api call collect.sh makes.  URL matching is by glob:
#   */actions/workflows (exact suffix)          → active workflow list (pre-jq)
#   */actions/workflows/*/runs* + --jq present  → run count (pre-jq integer)
#   */actions/workflows/*/runs* (no --jq)       → raw workflow_runs JSON
#   */actions/runs/*/jobs*                      → raw jobs JSON
#
# Set GH_COLLECT_FAIL=1 before calling shim_gh_collect (or export it) to make
# every gh call return exit 1 instead.
shim_gh_collect() {
  cat > "$SHIM_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${GH_COLLECT_FAIL:-0}" == "1" ]]; then
  echo "fake gh: API error (simulated)" >&2
  exit 1
fi
# $1=api, $2=URL, rest=optional flags
url="${2:-}"
if [[ "$url" == */actions/workflows && "$*" == *"--jq"* ]]; then
  # Step 1: active workflow list — output the jq-filtered result directly
  echo '[{"id":12345,"name":"CI","path":".github/workflows/ci.yml"}]'
elif [[ "$url" == */actions/workflows/*/runs* && "$*" == *"--jq"* ]]; then
  # Step 2: run count — output the jq '.total_count' result directly
  echo "42"
elif [[ "$url" == */actions/workflows/*/runs* ]]; then
  # Step 3: recent 100 runs — raw JSON (no --jq on this call)
  echo '{"workflow_runs":[{"id":99001,"run_started_at":"2024-01-01T10:00:00Z","updated_at":"2024-01-01T10:10:00Z","conclusion":"success"}]}'
elif [[ "$url" == */actions/runs/*/jobs* ]]; then
  # Step 5: jobs for the p50 run
  echo '{"jobs":[]}'
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
# Intercepts every python3 script call by basename of $1.  The DETECT_EXIT
# env var (default 0) controls whether detect_primary_workflow.py reports
# success (writes primary_workflow_id.txt) or ambiguity (writes candidates
# file, exits 2).  All other scripts write their expected output files or
# print the right value to stdout.
shim_python3_collect() {
  cat > "$SHIM_BIN/python3" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
script="$(basename "${1:-}")"
case "$script" in
  detect_primary_workflow.py)
    # $2=workflows.json  $3=repo  $4=candidates.json  (all from collect.sh)
    if [[ "${DETECT_EXIT:-0}" == "2" ]]; then
      printf '[{"id":12345,"name":"CI"},{"id":67890,"name":"Build"}]\n' > "${4:-/dev/null}"
      exit 2
    fi
    # Happy path: write the primary_workflow_id.txt next to workflows.json
    printf '12345\n' > "$(dirname "${2:-/dev/null}")/primary_workflow_id.txt"
    ;;
  find_p50_run.py)
    # Outputs: run_id  duration_minutes  created_at
    echo "99001 5.2 2024-01-01T10:00:00Z"
    ;;
  check_failures.py)
    echo "no chronic failures"
    ;;
  write_collect_summary.py)
    # Named flags now (e.g. --outputs-dir <dir> --repo <repo> ...); find the
    # value that follows --outputs-dir rather than assuming a fixed position.
    shift
    out_dir=""
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--outputs-dir" ]]; then
        out_dir="${2:-}"
        break
      fi
      shift
    done
    printf '{"summary":"ok"}\n' > "${out_dir:-/dev/null}/collect_summary.json"
    ;;
  write_collect_timing.py)
    # $2 = OUTPUT_DIR
    printf '{"duration":0}\n' > "${2:-/dev/null}/collect_timing.json"
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
  shim_gh_collect
  shim_python3_collect
  OUTPUT_DIR="$SANDBOX/outputs"
  # Reset control vars so earlier tests don't bleed into later ones
  unset GH_COLLECT_FAIL DETECT_EXIT
}

teardown() {
  destroy_sandbox
}

collect() {
  run bash "$COLLECT_SCRIPT" "$@"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@test "exits 0 and creates all expected output files when --workflow-id is provided and gh succeeds" {
  collect --repo test/repo --output-dir "$OUTPUT_DIR" --workflow-id 12345
  assert_success
  [ -f "$OUTPUT_DIR/workflows.json"        ]
  [ -f "$OUTPUT_DIR/run_count_primary.txt" ]
  [ -f "$OUTPUT_DIR/runs.json"             ]
  [ -f "$OUTPUT_DIR/p50_run.txt"           ]
  [ -f "$OUTPUT_DIR/jobs.json"             ]
  [ -f "$OUTPUT_DIR/failure_check.txt"     ]
  [ -f "$OUTPUT_DIR/workflow_stats.txt"    ]
  [ -f "$OUTPUT_DIR/collect_summary.json"  ]
  [ -f "$OUTPUT_DIR/collect_timing.json"   ]
  assert_output_contains "COLLECT OK"
}

@test "exits 2 and writes workflow_candidates.json when detect_primary_workflow.py reports ambiguity" {
  export DETECT_EXIT=2
  shim_python3_collect
  # No --workflow-id so detect_primary_workflow.py is invoked
  collect --repo test/repo --output-dir "$OUTPUT_DIR"
  assert_status 2
  [ -f "$OUTPUT_DIR/workflow_candidates.json" ]
}

@test "exits non-zero when gh api fails" {
  export GH_COLLECT_FAIL=1
  shim_gh_collect
  collect --repo test/repo --output-dir "$OUTPUT_DIR" --workflow-id 12345
  assert_failure
}

@test "creates --output-dir if it does not already exist" {
  local missing_dir="$SANDBOX/new/nested/dir"
  collect --repo test/repo --output-dir "$missing_dir" --workflow-id 12345
  assert_success
  [ -d "$missing_dir" ]
}
