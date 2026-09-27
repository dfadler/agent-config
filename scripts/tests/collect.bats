#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/collect.sh
#
# collect.sh is a thin entrypoint: argument handling plus one `exec` into
# collect_pipeline.py, which does the actual collection (workflows, run
# counts, runs, p50 run, jobs, failure check, secondary stats, summary,
# timing) in a single process. These tests cover the four key behaviours:
#
#   1. Happy path with --workflow-id: exits 0, creates all expected output files
#   2. Ambiguous detection (no --workflow-id): exits 2 and writes candidates JSON
#   3. gh api failure: exits non-zero
#   4. --output-dir creation: the directory is created if it does not yet exist
#
# Only `gh` is faked (overriding helpers.bash's hard-blocking shim for it) so
# no real network call ever happens. `python3` runs for real — collect_pipeline
# is a plain, importable module now, not a one-off CLI worth re-mocking piece
# by piece, so these tests exercise its actual logic end-to-end against the
# faked `gh` responses. `jq` is also left as the real system binary.

load helpers

COLLECT_SCRIPT="$REPO_ROOT/plugins/gha-ci-audit/scripts/collect.sh"

# ---------------------------------------------------------------------------
# gh shim
# ---------------------------------------------------------------------------
# Handles every gh api call collect_pipeline.py makes. URL matching is by
# glob/substring, ordered most-specific-first since "per_page=1" is itself a
# substring of "per_page=10" and "per_page=100":
#   */actions/workflows (exact suffix) + --jq   → active workflow list
#   */actions/runs/*/jobs*                      → jobs for the p50 run
#   *per_page=100*                              → recent 100 runs (raw JSON)
#   *per_page=10*                               → get_workflow_events (primary
#                                                  workflow detection)
#   *per_page=1*                                → run count (pre-jq integer)
#
# GH_WORKFLOWS_JSON / GH_EVENTS_JSON override the default single-workflow,
# single-event fixtures (used by the ambiguous-detection test, which needs
# two workflows that both look like a match). Set GH_COLLECT_FAIL=1 to make
# every gh call fail instead.
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
  # Step 1: active workflow list — output the jq-filtered result directly.
  # (Not `${GH_WORKFLOWS_JSON:-default-with-braces}`: bash's brace matching
  # for `${VAR:-word}` gets confused by literal `{`/`}` JSON characters in
  # the default word, silently reordering them — an explicit if/else sidesteps
  # that entirely.)
  if [[ -n "${GH_WORKFLOWS_JSON:-}" ]]; then
    echo "$GH_WORKFLOWS_JSON"
  else
    echo '[{"id":12345,"name":"CI","path":".github/workflows/ci.yml"}]'
  fi
elif [[ "$url" == */actions/runs/*/jobs* ]]; then
  # Step 5: jobs for the p50 run
  echo '{"jobs":[]}'
elif [[ "$url" == *"per_page=100"* ]]; then
  # Step 3: recent 100 runs — raw JSON (no --jq on this call)
  echo '{"workflow_runs":[{"id":99001,"run_started_at":"2024-01-01T10:00:00Z","updated_at":"2024-01-01T10:10:00Z","conclusion":"success","created_at":"2024-01-01T10:00:00Z"}]}'
elif [[ "$url" == *"per_page=10"* ]]; then
  # get_workflow_events: last-10-runs event check used for primary workflow
  # detection (only called when --workflow-id is omitted)
  if [[ -n "${GH_EVENTS_JSON:-}" ]]; then
    echo "$GH_EVENTS_JSON"
  else
    echo '["push"]'
  fi
elif [[ "$url" == *"per_page=1"* ]]; then
  # Step 2: run count — output the jq '.total_count' result directly
  echo "42"
else
  echo "fake gh: unexpected URL: $url  args: $*" >&2
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

@test "exits 2 and writes workflow_candidates.json when multiple workflows look primary" {
  export GH_WORKFLOWS_JSON='[{"id":12345,"name":"CI"},{"id":67890,"name":"Build"}]'
  export GH_EVENTS_JSON='["push"]'
  # No --workflow-id, so detect_primary_workflow runs and both workflows'
  # event checks report "push" — an ambiguous match.
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
