#!/usr/bin/env bash
# Thin entrypoint for the collect pipeline — all 8 collection steps
# (workflows, run counts, runs, p50 run, jobs, failure check, secondary
# stats, collect_summary + timing) now run in-process inside
# gha_ci_audit_collect.py (issue #368). This script just execs it.
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
# Requires: gh, jq, python3
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${SCRIPT_DIR}/gha_ci_audit_collect.py" "$@"
