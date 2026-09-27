#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/collect.sh
#
# collect.sh is now a thin `exec python3 gha_ci_audit_collect.py "$@"` (issue
# #368) — the real interpreter runs the real, unmodified module, so only `gh`
# needs faking here. These tests cover the four key behaviours:
#
#   1. Happy path with --workflow-id: exits 0, creates all expected output files
#   2. Ambiguous detection (no --workflow-id): exits 2 and writes candidates JSON
#   3. gh api failure: exits non-zero (an unhandled CalledProcessError from the
#      Python side, propagated by collect.sh's `exec`)
#   4. --output-dir creation: the directory is created if it does not yet exist
#
# gh is faked (overriding helpers.bash's hard-blocking shim) so no real
# network call ever happens. python3 is left as the real system interpreter —
# it's the thing under test now, not a dependency to stub out.

load helpers

COLLECT_SCRIPT="$REPO_ROOT/plugins/gha-ci-audit/scripts/collect.sh"

# ---------------------------------------------------------------------------
# gh shim
# ---------------------------------------------------------------------------
# Handles every `gh api` call gha_ci_audit_collect.py makes. Matching is by
# the --jq filter expression where one is present (the surest way to tell
# apart two calls that hit the same URL shape with different queries), and by
# URL glob for the two raw (no --jq) calls:
#
#   --jq mentions "select(.state"  → Step 1: active workflow list
#   --jq mentions "total_count"    → Step 2: 30-day run count
#   --jq mentions "event"          → get_workflow_events (auto-detect path only)
#   */actions/workflows/*/runs*    → Step 3: raw workflow_runs JSON (no --jq)
#   */actions/runs/*/jobs*         → Step 5: raw jobs JSON (no --jq)
#
# Set GH_COLLECT_FAIL=1 to make every gh call return exit 1 instead.
# Set GH_WORKFLOWS_JSON to override the Step 1 workflow list (default: one
# workflow, id 12345). Set GH_EVENTS_JSON to override what every
# get_workflow_events call reports (default: ["push"], i.e. everything looks
# like a primary CI workflow — the ambiguous-detection test relies on this).
shim_gh_collect() {
  cat > "$SHIM_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
if [[ "${GH_COLLECT_FAIL:-0}" == "1" ]]; then
  echo "fake gh: API error (simulated)" >&2
  exit 1
fi
# $1=api, $2=URL, then optionally --jq <expr>
url="${2:-}"
jq_expr=""
if [[ "${3:-}" == "--jq" ]]; then
  jq_expr="${4:-}"
fi

if [[ "$jq_expr" == *'select(.state'* ]]; then
  # A literal `}` inside a `${VAR:-default}` default value confuses bash's
  # brace matching (it can end the expansion early at the JSON object's own
  # closing brace) — so build the default in a plain variable first instead
  # of inlining JSON inside the parameter expansion.
  workflows_json="${GH_WORKFLOWS_JSON:-}"
  if [[ -z "$workflows_json" ]]; then
    workflows_json='[{"id":12345,"name":"CI","path":".github/workflows/ci.yml"}]'
  fi
  echo "$workflows_json"
elif [[ "$jq_expr" == *total_count* ]]; then
  echo "42"
elif [[ "$jq_expr" == *event* ]]; then
  events_json="${GH_EVENTS_JSON:-}"
  if [[ -z "$events_json" ]]; then
    events_json='["push"]'
  fi
  echo "$events_json"
elif [[ "$url" == */actions/workflows/*/runs* ]]; then
  echo '{"workflow_runs":[{"id":99001,"run_started_at":"2024-01-01T10:00:00Z","updated_at":"2024-01-01T10:10:00Z","conclusion":"success"}]}'
elif [[ "$url" == */actions/runs/*/jobs* ]]; then
  echo '{"jobs":[]}'
else
  echo "fake gh: unexpected call: url=$url jq=$jq_expr args: $*" >&2
  exit 3
fi
EOF
  chmod +x "$SHIM_BIN/gh"
}

# ---------------------------------------------------------------------------
# per-test setup / teardown
# ---------------------------------------------------------------------------

setup() {
  make_sandbox
  shim_gh_collect
  OUTPUT_DIR="$SANDBOX/outputs"
  # Reset control vars so earlier tests don't bleed into later ones
  unset GH_COLLECT_FAIL GH_WORKFLOWS_JSON GH_EVENTS_JSON
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
  [ -f "$OUTPUT_DIR/failure_check.json"    ]
  [ -f "$OUTPUT_DIR/workflow_stats.txt"    ]
  [ -f "$OUTPUT_DIR/collect_summary.json"  ]
  [ -f "$OUTPUT_DIR/collect_timing.json"   ]
  assert_output_contains "COLLECT OK"
}

@test "exits 2 and writes workflow_candidates.json when primary workflow detection is ambiguous" {
  export GH_WORKFLOWS_JSON='[{"id":12345,"name":"CI"},{"id":67890,"name":"Build"}]'
  export GH_EVENTS_JSON='["push"]'
  # No --workflow-id, so get_workflow_events runs for every workflow; both
  # report "push" here, so both are primary candidates → ambiguous.
  collect --repo test/repo --output-dir "$OUTPUT_DIR"
  assert_status 2
  [ -f "$OUTPUT_DIR/workflow_candidates.json" ]
}

@test "exits non-zero when gh api fails" {
  export GH_COLLECT_FAIL=1
  collect --repo test/repo --output-dir "$OUTPUT_DIR" --workflow-id 12345
  assert_failure
}

@test "creates --output-dir if it does not already exist" {
  local missing_dir="$SANDBOX/new/nested/dir"
  collect --repo test/repo --output-dir "$missing_dir" --workflow-id 12345
  assert_success
  [ -d "$missing_dir" ]
}
