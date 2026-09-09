#!/usr/bin/env bash
# Enforce a floor on the pytest suite's line coverage, as measured by
# pytest-cov (coverage.py under the hood).
#
# pytest-cov writes its summary as a coverage.py "JSON report" — the object
# this script reads is `.totals.percent_covered`, NOT the top-level
# `percent_covered` kcov's own coverage.json uses (see
# scripts/check-shell-coverage.sh) — the two tools shape their JSON
# differently and this script is deliberately NOT a copy-paste of that one
# with the field name swapped in-place; both arguments are required the same
# way, for the same reason: a defaulted path that silently misses is how a
# coverage gate ends up reporting on a file nobody wrote.
#
# The floor is a MEASURED baseline, not an aspiration: see the comment above
# the `coverage-py` target in the Makefile for the number and how it was
# taken. Lowering it should require a deliberate commit, which is why the
# value lives in the Makefile rather than being inferred from a previous run.
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_FAILURE=1
readonly EXIT_USAGE=2
readonly EXIT_DEPENDENCY=4
readonly EXIT_INTERNAL=20

usage() {
  cat <<'USAGE'
Usage: check-python-coverage.sh [-h|--help] <coverage.json> <min-threshold>

Enforce a floor on pytest-cov-measured line coverage. Reads
`.totals.percent_covered` from the given coverage.py JSON report (as produced
by `make coverage-py`) and fails if it is below <min-threshold>, a percentage
such as 33.

  -h, --help   Show this message and exit.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit "$EXIT_OK"
    ;;
esac

if [ "$#" -lt 2 ]; then
  echo "::error::usage: $0 <coverage.json> <min-threshold>" >&2
  usage >&2
  exit "$EXIT_USAGE"
fi

COVERAGE_FILE="$1"
MIN_THRESHOLD="$2"

if [ ! -f "$COVERAGE_FILE" ]; then
  echo "::error::coverage file not found: $COVERAGE_FILE" >&2
  exit "$EXIT_USAGE"
fi

# Both sides of the comparison are validated as numbers before any arithmetic:
# a non-numeric threshold (a typo, an unexpanded make variable) or a garbled
# coverage value must fail LOUDLY rather than silently compare as 0.
if ! [[ "$MIN_THRESHOLD" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "::error::threshold value is not numeric: '$MIN_THRESHOLD'" >&2
  exit "$EXIT_USAGE"
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "::error::jq is required to read $COVERAGE_FILE" >&2
  exit "$EXIT_DEPENDENCY"
fi

# -e so a missing or null `totals.percent_covered` exits non-zero instead of
# printing the string "null" and sailing on into the comparison.
COVERAGE="$(jq -e -r '.totals.percent_covered' "$COVERAGE_FILE" 2>/dev/null)" || {
  echo "::error::could not read coverage data from $COVERAGE_FILE" >&2
  exit "$EXIT_INTERNAL"
}

if ! [[ "$COVERAGE" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
  echo "::error::coverage value is not numeric: '$COVERAGE'" >&2
  exit "$EXIT_INTERNAL"
fi

echo "Python coverage: ${COVERAGE}%"

# awk, not bc, for the float comparison: awk is in POSIX and present on every
# machine that can run this repo's other checks, whereas bc is absent from
# stock macOS-adjacent and slim container images alike. A missing bc would
# make the `if` fail and the check pass — fail-OPEN, the one outcome a
# coverage gate must never have.
if awk -v c="$COVERAGE" -v m="$MIN_THRESHOLD" 'BEGIN { exit !(c < m) }'; then
  echo "::error::Coverage ${COVERAGE}% is below the ${MIN_THRESHOLD}% minimum threshold" >&2
  exit "$EXIT_FAILURE"
fi

echo "✓ Coverage ${COVERAGE}% meets the ${MIN_THRESHOLD}% baseline"
