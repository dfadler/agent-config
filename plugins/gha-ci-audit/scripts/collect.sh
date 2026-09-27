#!/usr/bin/env bash
# Collect all GitHub Actions data for one eval.
#
# Usage:
#   collect.sh --repo <owner/repo> --output-dir <path> [--workflow-id <id>]
#
# Exit codes:
#   0  Success — all output files written
#   1  Fatal error
#   2  Ambiguous primary workflow — workflow_candidates.json written; caller
#      must re-invoke with --workflow-id <id> after AI disambiguation
#
# This is a thin entrypoint: argument handling plus one call into
# collect_pipeline.py, which does the actual collection (workflows, run
# counts, runs, p50 run, jobs, failure check, secondary stats,
# collect_summary, collect_timing) in a single process rather than the
# six-subprocess/file-handoff pipeline this script used to run itself.
#
# Requires: gh, jq, python3

set -euo pipefail

REPO=""
OUTPUT_DIR=""
WORKFLOW_ID=""

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --workflow-id)
      WORKFLOW_ID="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

[[ -z "$REPO" ]] && {
  echo "--repo is required" >&2
  exit 1
}
[[ -z "$OUTPUT_DIR" ]] && {
  echo "--output-dir is required" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$OUTPUT_DIR"

# Not a `WORKFLOW_ID_ARGS=(); [[ -n "$WORKFLOW_ID" ]] && WORKFLOW_ID_ARGS=(...)`
# array, deliberately: bash 3.2 (macOS's default /bin/bash) treats
# `"${arr[@]}"` on a still-empty array as an unbound-variable error under
# `set -u`. Two plain exec calls sidestep that entirely.
if [[ -n "$WORKFLOW_ID" ]]; then
  exec python3 "${SCRIPT_DIR}/collect_pipeline.py" \
    --repo "$REPO" \
    --output-dir "$OUTPUT_DIR" \
    --workflow-id "$WORKFLOW_ID"
else
  exec python3 "${SCRIPT_DIR}/collect_pipeline.py" \
    --repo "$REPO" \
    --output-dir "$OUTPUT_DIR"
fi
