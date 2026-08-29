#!/usr/bin/env bash
# Verify every executable shell script declares `set -uo pipefail` (or
# `set -euo pipefail`) as its first real statement — the convention in
# ~/.claude/CLAUDE.md's shell-script hygiene baseline. shellcheck has no
# built-in rule for this, so it's enforced here.
#
# A file with no shebang is assumed to be sourced-only and is skipped: the
# convention explicitly exempts those.
set -euo pipefail

# Exit-code taxonomy — see the hygiene baseline in claude/CLAUDE.md.
readonly EXIT_OK=0
readonly EXIT_FAILURE=1
readonly EXIT_USAGE=2

usage() {
  cat <<'USAGE'
Usage: check-shell-set-flags.sh [-h|--help] [DIR...]

Verify every executable shell script under DIR (default: scripts plugins
setup.sh) declares `set -uo pipefail` (or `set -euo pipefail`) as its first
real statement.

  -h, --help   Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit "$EXIT_OK"
      ;;
    --)
      shift
      break
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
    *)
      break
      ;;
  esac
  shift
done

dirs=("$@")
[ "${#dirs[@]}" -eq 0 ] && dirs=(scripts plugins setup.sh)

missing=()

while IFS= read -r -d '' file; do
  first_line="$(head -n1 "$file")"
  case "$first_line" in
    '#!'*) ;;
    *) continue ;;
  esac

  # The first line that isn't the shebang, blank, or a comment is the script's
  # first real statement — header comments here run for dozens of lines, so
  # this can't just check a fixed line window.
  first_stmt="$(awk 'NR==1{next} /^[[:space:]]*$/{next} /^[[:space:]]*#/{next} {print; exit}' "$file")"

  # Both -u and -o must be present in the flag cluster: only -o consumes the
  # following word as its argument, so `set -eu pipefail` (no -o) leaves
  # "pipefail" as an unused positional parameter and never actually enables
  # it — a plausible typo that a flags-only substring match would accept.
  compliant=0
  if [[ "$first_stmt" =~ ^set\ (-[a-zA-Z]+)\ pipefail$ ]]; then
    flags="${BASH_REMATCH[1]}"
    [[ "$flags" == *u* && "$flags" == *o* ]] && compliant=1
  fi
  [ "$compliant" -eq 1 ] || missing+=("$file")
done < <(find "${dirs[@]}" -type f -name '*.sh' -print0 2>/dev/null)

if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::Missing 'set -uo pipefail' (or -euo) as the first statement in:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "See the shell-script hygiene baseline in ~/.claude/CLAUDE.md." >&2
  exit "$EXIT_FAILURE"
fi

echo "✓ All executable shell scripts declare set -u.../pipefail as their first statement."
