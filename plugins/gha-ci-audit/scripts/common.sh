#!/usr/bin/env bash
# sourced-only
# Shared shell helpers for gha-ci-audit scripts. Source this file — it
# defines functions and does not run anything on its own, so it deliberately
# does not set -euo pipefail (that would apply to whatever sources it too).

# thirty_days_ago_iso: print an ISO-8601 timestamp ~30 days before now.
# Tries BSD date (macOS) first, falls back to GNU date (Linux), and prints
# nothing if neither works — callers treat an empty result as "omit the
# created>= filter."
thirty_days_ago_iso() {
  date -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
    date -d '30 days ago' --iso-8601=seconds 2>/dev/null ||
    echo ""
}
