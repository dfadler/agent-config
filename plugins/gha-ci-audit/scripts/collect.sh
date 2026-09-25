#!/usr/bin/env bash
# Collect all GitHub Actions data for one eval.
#
# Usage:
#   collect.sh --repo <owner/repo> --output-dir <path> [--workflow-id <id>]
#
# Exit codes:
#   0  Success — all output files written
#   1  Fatal error
#   2  Ambiguous primary workflow — workflow_candidates.json written; caller must
#      re-invoke with --workflow-id <id> after AI disambiguation
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
# shellcheck source=plugins/gha-ci-audit/scripts/common.sh
source "${SCRIPT_DIR}/common.sh"
mkdir -p "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Wall-clock timing — capture start
# ---------------------------------------------------------------------------
START_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
START_EPOCH=$(date +%s)

# ---------------------------------------------------------------------------
# Step 1: Discover active workflows
# ---------------------------------------------------------------------------
echo "[collect] Step 1: fetching workflow list for ${REPO}" >&2
gh api "repos/${REPO}/actions/workflows" \
  --jq '[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)' \
  >"${OUTPUT_DIR}/workflows.json"

# ---------------------------------------------------------------------------
# Primary workflow detection
# ---------------------------------------------------------------------------
if [[ -z "$WORKFLOW_ID" ]]; then
  echo "[collect] Detecting primary CI workflow" >&2
  python3 "${SCRIPT_DIR}/detect_primary_workflow.py" \
    "${OUTPUT_DIR}/workflows.json" \
    "$REPO" \
    "${OUTPUT_DIR}/workflow_candidates.json"
  DETECT_EXIT=$?
  if [[ $DETECT_EXIT -eq 2 ]]; then
    echo "[collect] AMBIGUOUS: multiple primary workflow candidates found." >&2
    echo "[collect] See ${OUTPUT_DIR}/workflow_candidates.json" >&2
    exit 2
  fi
  WORKFLOW_ID=$(cat "${OUTPUT_DIR}/primary_workflow_id.txt")
fi

# Resolve the human-readable workflow name from workflows.json
PRIMARY_WF_NAME=$(jq -r --argjson id "${WORKFLOW_ID}" \
  '.[] | select(.id == $id) | .name' \
  "${OUTPUT_DIR}/workflows.json")
if [[ -z "$PRIMARY_WF_NAME" || "$PRIMARY_WF_NAME" == "null" ]]; then
  PRIMARY_WF_NAME="unknown"
fi

echo "[collect] Primary workflow: ${PRIMARY_WF_NAME} (id=${WORKFLOW_ID})" >&2

# ---------------------------------------------------------------------------
# Step 2: Fetch run count (last 30 days)
# ---------------------------------------------------------------------------
echo "[collect] Step 2: fetching 30-day run count" >&2
SINCE=$(thirty_days_ago_iso)

COUNT_QUERY="repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=1"
if [[ -n "$SINCE" ]]; then
  COUNT_QUERY="${COUNT_QUERY}&created=>=${SINCE}"
fi
gh api "${COUNT_QUERY}" --jq '.total_count' >"${OUTPUT_DIR}/run_count_primary.txt"

# ---------------------------------------------------------------------------
# Step 3: Fetch recent runs (last 100)
# ---------------------------------------------------------------------------
echo "[collect] Step 3: fetching workflow runs" >&2
gh api "repos/${REPO}/actions/workflows/${WORKFLOW_ID}/runs?per_page=100" \
  >"${OUTPUT_DIR}/runs.json"

# ---------------------------------------------------------------------------
# Step 4: Find the p50 representative run
# ---------------------------------------------------------------------------
echo "[collect] Step 4: computing p50 run" >&2
python3 "${SCRIPT_DIR}/find_p50_run.py" "${OUTPUT_DIR}/runs.json" \
  >"${OUTPUT_DIR}/p50_run.txt"

P50_RUN_ID=$(awk '{print $1}' "${OUTPUT_DIR}/p50_run.txt")
P50_DURATION=$(awk '{print $2}' "${OUTPUT_DIR}/p50_run.txt" | tr -d 'm')

# ---------------------------------------------------------------------------
# Step 5: Fetch jobs for the p50 run
# ---------------------------------------------------------------------------
echo "[collect] Step 5: fetching jobs for p50 run ${P50_RUN_ID}" >&2
gh api "repos/${REPO}/actions/runs/${P50_RUN_ID}/jobs?per_page=100" \
  >"${OUTPUT_DIR}/jobs.json"

# ---------------------------------------------------------------------------
# Step 6: Check for chronic failures
# ---------------------------------------------------------------------------
echo "[collect] Step 6: checking for chronic failures" >&2
FAILURE_EXIT=0
python3 "${SCRIPT_DIR}/check_failures.py" "${OUTPUT_DIR}/runs.json" \
  >"${OUTPUT_DIR}/failure_check.txt" 2>&1 || FAILURE_EXIT=$?
echo "exit_code=${FAILURE_EXIT}" >>"${OUTPUT_DIR}/failure_check.txt"

# ---------------------------------------------------------------------------
# Step 7: Fetch secondary workflow stats
# ---------------------------------------------------------------------------
echo "[collect] Step 7: fetching secondary workflow stats" >&2
SECONDARY_IDS=$(jq -r --argjson id "${WORKFLOW_ID}" \
  '[.[] | select(.id != $id) | .id | tostring] | join(" ")' \
  "${OUTPUT_DIR}/workflows.json")

if [[ -z "$SECONDARY_IDS" ]]; then
  echo "no secondary workflows" >"${OUTPUT_DIR}/workflow_stats.txt"
else
  # shellcheck disable=SC2086
  bash "${SCRIPT_DIR}/fetch_workflow_stats.sh" "$REPO" $SECONDARY_IDS \
    >"${OUTPUT_DIR}/workflow_stats.txt" 2>&1
fi

# ---------------------------------------------------------------------------
# Step 8: Write collect_summary.json
# ---------------------------------------------------------------------------
echo "[collect] Step 8: writing collect_summary.json" >&2
RUN_COUNT=$(cat "${OUTPUT_DIR}/run_count_primary.txt")
python3 "${SCRIPT_DIR}/write_collect_summary.py" \
  "${OUTPUT_DIR}" \
  "${REPO}" \
  "${WORKFLOW_ID}" \
  "${PRIMARY_WF_NAME}" \
  "${P50_RUN_ID}" \
  "${P50_DURATION}" \
  "${RUN_COUNT}"

# ---------------------------------------------------------------------------
# Timing — compute and write collect_timing.json
# ---------------------------------------------------------------------------
END_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
END_EPOCH=$(date +%s)
DURATION=$((END_EPOCH - START_EPOCH))

python3 "${SCRIPT_DIR}/write_collect_timing.py" \
  "${OUTPUT_DIR}" "${DURATION}" "${START_ISO}" "${END_ISO}"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo "COLLECT OK: ${REPO}  primary=${PRIMARY_WF_NAME} id=${WORKFLOW_ID}  p50_run=${P50_RUN_ID}  runs_30d=${RUN_COUNT}"
