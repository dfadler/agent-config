#!/usr/bin/env bash
# Enforce a ceiling on claude/CLAUDE.md's line count.
#
# claude/CLAUDE.md is the *global* ~/.claude/CLAUDE.md (see setup.sh), loaded
# into every session on this machine regardless of project — Claude Code's own
# guidance is to keep a CLAUDE.md under ~200 lines. Nothing watched this file's
# size before #137: it grew by 48 commits (352 lines) in under a week with no
# gate anywhere. This is the gate.
#
# In the same spirit as the coverage floor (see the `coverage` target in the
# Makefile): the threshold is a MEASURED baseline plus headroom, not an
# aspiration, and lives in the Makefile so lowering or raising it takes a
# deliberate commit rather than an inferred value.
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_FAILURE=1
readonly EXIT_USAGE=2

usage() {
  cat <<'USAGE'
Usage: check-claude-md-lines.sh [-h|--help] <file> <max-lines>

Fail if <file> has more than <max-lines> lines.

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
  echo "::error::usage: $0 <file> <max-lines>" >&2
  usage >&2
  exit "$EXIT_USAGE"
fi

FILE="$1"
MAX_LINES="$2"

if [ ! -f "$FILE" ]; then
  echo "::error::file not found: $FILE" >&2
  exit "$EXIT_USAGE"
fi

if ! [[ "$MAX_LINES" =~ ^[0-9]+$ ]]; then
  echo "::error::max-lines value is not a non-negative integer: '$MAX_LINES'" >&2
  exit "$EXIT_USAGE"
fi

LINES="$(wc -l <"$FILE" | tr -d '[:space:]')"

if [ "$LINES" -gt "$MAX_LINES" ]; then
  echo "::error::$FILE is $LINES lines, over the $MAX_LINES-line ceiling — trim it or move content that isn't universally relevant into a skill/doc instead (see #137)." >&2
  exit "$EXIT_FAILURE"
fi

echo "✓ $FILE is $LINES lines (ceiling: $MAX_LINES)"
