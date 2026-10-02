#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/launch_viewer.sh
#
# The script finds skill-creator's generate_review.py, starts it in the
# background on a port, and records a PID file. These tests cover:
#
#   1. Argument errors: no iteration dir, an unknown flag (exit 1)
#   2. generate_review.py not found under CLAUDE_SKILL_CREATOR_DIR (exit 1)
#   3. A successful launch: URL printed, PID file written, default port,
#      --skill-name passed, --benchmark only when benchmark.json exists
#   4. --previous and --port are forwarded
#   5. A viewer that dies at startup is reported with its log (exit 1)
#   6. An existing process on the port is stopped first
#
# python3 (the viewer) and lsof are shimmed so no real viewer starts and no real
# process on a real port is ever looked up or killed.

load helpers

LAUNCH="$REPO_ROOT/plugins/gha-ci-audit/scripts/launch_viewer.sh"

# Fake python3: records its arguments, then either dies (FAKE_PY_FAIL=1) or
# stays alive like a server until the test tears it down.
shim_python3_viewer() {
  cat > "$SHIM_BIN/python3" <<'EOF'
#!/usr/bin/env bash
echo "$*" > "$PY_ARGS_FILE"
if [[ "${FAKE_PY_FAIL:-}" == "1" ]]; then
  echo "viewer boom" >&2
  exit 1
fi
exec sleep 30
EOF
  chmod +x "$SHIM_BIN/python3"
}

# Fake lsof: prints FAKE_LSOF_PID (a process this test started) or nothing.
shim_lsof() {
  cat > "$SHIM_BIN/lsof" <<'EOF'
#!/usr/bin/env bash
[[ -n "${FAKE_LSOF_PID:-}" ]] && echo "$FAKE_LSOF_PID"
exit 0
EOF
  chmod +x "$SHIM_BIN/lsof"
}

setup() {
  make_sandbox
  shim_python3_viewer
  shim_lsof
  export PY_ARGS_FILE="$SANDBOX/py-args"
  export CLAUDE_SKILL_CREATOR_DIR="$SANDBOX/skill-creator"
  mkdir -p "$CLAUDE_SKILL_CREATOR_DIR/eval-viewer"
  : > "$CLAUDE_SKILL_CREATOR_DIR/eval-viewer/generate_review.py"
  mkdir -p "$SANDBOX/iteration-1" "$SANDBOX/iteration-0"
  cd "$SANDBOX" || return
}

teardown() {
  # Stop any fake viewer a test left running.
  if [[ -f "$SANDBOX/iteration-1/.viewer.pid" ]]; then
    kill "$(cat "$SANDBOX/iteration-1/.viewer.pid")" 2>/dev/null || true
  fi
  destroy_sandbox
}

@test "exits 1 with usage when no iteration directory is given" {
  run bash "$LAUNCH"
  assert_status 1
  assert_output_contains "Usage:"
}

@test "exits 1 on an unknown flag" {
  run bash "$LAUNCH" iteration-1 --bogus
  assert_status 1
  assert_output_contains "Unknown flag: --bogus"
}

@test "exits 1 when generate_review.py cannot be found" {
  rm "$CLAUDE_SKILL_CREATOR_DIR/eval-viewer/generate_review.py"
  run bash "$LAUNCH" iteration-1
  assert_status 1
  assert_output_contains "generate_review.py not found"
}

@test "launches the viewer on the default port and writes a PID file" {
  run bash "$LAUNCH" iteration-1
  assert_success
  assert_output_contains "Viewer running at http://localhost:3117"
  [ -s iteration-1/.viewer.pid ]
  kill -0 "$(cat iteration-1/.viewer.pid)"
  grep -q -- "--skill-name gha-ci-audit" "$PY_ARGS_FILE"
  grep -q -- "--port 3117" "$PY_ARGS_FILE"
}

@test "passes --benchmark only when benchmark.json exists" {
  run bash "$LAUNCH" iteration-1
  assert_success
  run grep -q -- "--benchmark" "$PY_ARGS_FILE"
  assert_failure
  kill "$(cat iteration-1/.viewer.pid)" 2>/dev/null || true

  : > iteration-1/benchmark.json
  run bash "$LAUNCH" iteration-1
  assert_success
  grep -q -- "--benchmark $SANDBOX/iteration-1/benchmark.json" "$PY_ARGS_FILE"
}

@test "forwards --previous as an absolute path and --port" {
  run bash "$LAUNCH" iteration-1 --previous iteration-0 --port 4242
  assert_success
  assert_output_contains "http://localhost:4242"
  grep -q -- "--previous-workspace $SANDBOX/iteration-0" "$PY_ARGS_FILE"
  grep -q -- "--port 4242" "$PY_ARGS_FILE"
}

@test "reports the log and exits 1 when the viewer dies at startup" {
  FAKE_PY_FAIL=1 run bash "$LAUNCH" iteration-1
  assert_status 1
  assert_output_contains "Viewer failed to start"
  assert_output_contains "viewer boom"
}

@test "stops an existing process on the port before launching" {
  sleep 30 &
  old_pid=$!
  FAKE_LSOF_PID="$old_pid" run bash "$LAUNCH" iteration-1
  assert_success
  assert_output_contains "Stopping existing viewer on port 3117 (PID $old_pid)"
  run kill -0 "$old_pid"
  assert_failure
}
