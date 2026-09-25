#!/usr/bin/env bash
# Fetch run counts and timing stats for one or more workflow IDs in a repo.
#
# Usage:
#   fetch_workflow_stats.sh <owner/repo> <workflow_id> [workflow_id ...]
#
# Example:
#   fetch_workflow_stats.sh vitejs/vite 6990137 321928489 275784503
#
# Output: one line per workflow — id | name | runs (30d) | avg_min | p90_min
#
# Requires: gh, jq, python3
set -euo pipefail

REPO="${1:?Usage: $0 <owner/repo> <wf_id> [wf_id ...]}"
shift
WORKFLOW_IDS=("$@")
if [[ ${#WORKFLOW_IDS[@]} -eq 0 ]]; then
  echo "Error: provide at least one workflow ID" >&2
  exit 1
fi

SINCE=$(date -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d '30 days ago' --iso-8601=seconds 2>/dev/null || echo "")

printf '%-12s  %-40s  %8s  %8s  %8s\n' 'WF_ID' 'NAME' 'RUNS_30D' 'AVG_MIN' 'P90_MIN'
printf '%s\n' '--------------------------------------------------------------------------------------------'

for wf_id in "${WORKFLOW_IDS[@]}"; do
  # Workflow name
  name=$(gh api "repos/${REPO}/actions/workflows/${wf_id}" --jq '.name' 2>/dev/null || echo "unknown")

  # Run count (last 30 days) — single-page query is cheaper than paginating
  count_args="repos/${REPO}/actions/workflows/${wf_id}/runs?per_page=1"
  if [[ -n "${SINCE}" ]]; then
    count_args="${count_args}&created=>=${SINCE}"
  fi
  count=$(gh api "${count_args}" --jq '.total_count' 2>/dev/null || echo "?")

  # Timing stats from last 100 completed runs
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  timing=$(gh api "repos/${REPO}/actions/workflows/${wf_id}/runs?per_page=100" \
    --jq '[.workflow_runs[] | select(.conclusion != null) | {s: .run_started_at, e: .updated_at}]' \
    2>/dev/null | python3 "${SCRIPT_DIR}/compute_workflow_timing.py"
  )

  avg_min=$(echo "$timing" | awk '{print $1}')
  p90_min=$(echo "$timing" | awk '{print $2}')

  printf '%-12s  %-40s  %8s  %8s  %8s\n' "$wf_id" "${name:0:40}" "$count" "$avg_min" "$p90_min"
done
