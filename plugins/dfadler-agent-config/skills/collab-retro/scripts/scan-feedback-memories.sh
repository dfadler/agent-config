#!/usr/bin/env bash
# Lists feedback-type auto-memory files across every Claude Code project on
# this machine, for the collab-retro skill to read and judge.
#
# Auto-memory writes one file per memory under
# ~/.claude/projects/<project-slug>/memory/*.md, each with YAML frontmatter
# (see claude/CLAUDE.md's "auto memory" section) including `metadata.type`.
# This script is the exhaustive-tool half of the job — finding every
# feedback-type file and skipping ones already surfaced — so the skill
# doesn't rely on remembering which projects it has looked at before; the
# semantic judgment (which files describe a recurring, redactable, this-repo-
# fixable pattern) stays with the model reading each file's content.
set -uo pipefail

EXIT_OK=0
EXIT_USAGE=2
EXIT_DEPENDENCY=4

usage() {
  cat <<'USAGE'
Usage: scan-feedback-memories.sh [-h|--help]

Lists this machine's feedback-type auto-memory files (metadata.type:
feedback in the file's frontmatter) across every Claude Code project,
skipping any file that already records having been surfaced as a
collab-retro issue (a line containing "Surfaced as dfadler/agent-config#").

Tab-separated output, newest first:

  <mtime-iso>	<project-slug>	<memory-name>	<path>

Read each printed path directly (e.g. with the Read tool) to judge its
content — this script only locates candidates, it does not interpret them.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit "$EXIT_OK"
    ;;
esac

if [[ $# -gt 0 ]]; then
  echo "error: unexpected argument: $1" >&2
  usage >&2
  exit "$EXIT_USAGE"
fi

if ! command -v find >/dev/null 2>&1; then
  echo "error: find is required but not on PATH" >&2
  exit "$EXIT_DEPENDENCY"
fi

memory_root="$HOME/.claude/projects"

if [[ ! -d "$memory_root" ]]; then
  # No projects have ever written memory on this machine yet — not an error.
  exit "$EXIT_OK"
fi

while IFS= read -r -d '' file; do
  # Frontmatter is delimited by a leading and trailing "---" line; restrict
  # the type check to the region between them (n==1) so a "feedback" mention
  # in the memory's own body text doesn't produce a false match.
  if ! awk '/^---$/ { n++; next } n == 1' "$file" | grep -q 'type:[[:space:]]*feedback'; then
    continue
  fi
  if grep -q 'Surfaced as dfadler/agent-config#' "$file"; then
    continue
  fi
  name=$(awk -F': *' '/^name:/ { print $2; exit }' "$file")
  project="$(basename "$(dirname "$(dirname "$file")")")"
  mtime="$(date -r "$file" +%Y-%m-%dT%H:%M:%S)"
  printf '%s\t%s\t%s\t%s\n' "$mtime" "$project" "$name" "$file"
done < <(find "$memory_root" -path '*/memory/*.md' -print0 2>/dev/null) | sort -r
