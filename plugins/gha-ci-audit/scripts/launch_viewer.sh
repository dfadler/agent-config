#!/usr/bin/env bash
# Launch the gha-ci-audit eval viewer.
#
# Usage:
#   launch_viewer.sh <iteration_dir> [--previous <prev_iteration_dir>] [--port <port>]
#
# Examples:
#   launch_viewer.sh iteration-2
#   launch_viewer.sh iteration-2 --previous iteration-1
#   launch_viewer.sh iteration-2 --previous iteration-1 --port 3118
#
# The viewer restarts on every HTTP request, so it always shows the latest outputs.
# A PID file is written so you can kill it cleanly.
#
# Env:
#   CLAUDE_SKILL_CREATOR_DIR  Override the skill-creator directory searched for
#                             generate_review.py (default: the macOS
#                             local-agent-mode-sessions path below).

set -euo pipefail

# Find the skill-creator's eval-viewer script
SKILL_CREATOR_DIR="${CLAUDE_SKILL_CREATOR_DIR:-${HOME}/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin}"
VIEWER_SCRIPT="$(find "$SKILL_CREATOR_DIR" -name "generate_review.py" -maxdepth 8 2>/dev/null | head -1)"

if [[ -z "$VIEWER_SCRIPT" ]]; then
  echo "Error: generate_review.py not found under $SKILL_CREATOR_DIR" >&2
  exit 1
fi

# Parse args
ITERATION_DIR=""
PREVIOUS_DIR=""
PORT=3117

while [[ $# -gt 0 ]]; do
  case "$1" in
    --previous)
      PREVIOUS_DIR="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      ITERATION_DIR="$1"
      shift
      ;;
  esac
done

if [[ -z "$ITERATION_DIR" ]]; then
  echo "Usage: $0 <iteration_dir> [--previous <prev_dir>] [--port <port>]" >&2
  exit 1
fi

# Resolve to absolute path
ITERATION_DIR="$(cd "$ITERATION_DIR" && pwd)"

# Kill any existing viewer on this port
EXISTING_PID="$(lsof -ti ":$PORT" 2>/dev/null || true)"
if [[ -n "$EXISTING_PID" ]]; then
  echo "Stopping existing viewer on port $PORT (PID $EXISTING_PID)..."
  kill "$EXISTING_PID" 2>/dev/null || true
  sleep 0.5
fi

# Build command
VIEWER_CMD=(python3 "$VIEWER_SCRIPT" "$ITERATION_DIR" --skill-name "gha-ci-audit" --port "$PORT")

# Add benchmark if it exists
BENCHMARK="$ITERATION_DIR/benchmark.json"
if [[ -f "$BENCHMARK" ]]; then
  VIEWER_CMD+=(--benchmark "$BENCHMARK")
fi

# Add previous workspace if specified
if [[ -n "$PREVIOUS_DIR" ]]; then
  VIEWER_CMD+=(--previous-workspace "$(cd "$PREVIOUS_DIR" && pwd)")
fi

# Launch in background
PID_FILE="$ITERATION_DIR/.viewer.pid"
LOG_FILE="$ITERATION_DIR/.viewer.log"

nohup "${VIEWER_CMD[@]}" >"$LOG_FILE" 2>&1 &
VIEWER_PID=$!
echo "$VIEWER_PID" >"$PID_FILE"

# Wait briefly and verify it started
sleep 1
if ! kill -0 "$VIEWER_PID" 2>/dev/null; then
  echo "Viewer failed to start. Log:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "Viewer running at http://localhost:$PORT (PID $VIEWER_PID)"
echo "Log: $LOG_FILE"
echo "Stop: kill \$(cat $PID_FILE)"
