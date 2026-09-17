#!/usr/bin/env bash
# Undo setup.sh: remove this repo's symlinks from ~/.claude/ and restore
# ~/.claude/CLAUDE.md from ~/.claude/CLAUDE.personal.md.
#
# Safe to re-run: only touches symlinks that point into this repo; skips
# anything that has already been removed.
#
# Usage: ./teardown.sh

set -uo pipefail

EXIT_OK=0
EXIT_USAGE=2

usage() {
  cat <<'USAGE'
Usage: ./teardown.sh

Removes this repo's symlinks from ~/.claude and restores ~/.claude/CLAUDE.md
from ~/.claude/CLAUDE.personal.md (the inverse of setup.sh).

  -h, --help   Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit "$EXIT_OK"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Discover the same plugin set setup.sh would link — keeps this script in sync
# automatically when a plugin is added or removed.
PLUGIN_SRCS=()
PLUGIN_LINKS=()
for plugin_dir in "$REPO_ROOT"/plugins/*/; do
  plugin_dir="${plugin_dir%/}"
  [[ -f "$plugin_dir/.claude-plugin/plugin.json" ]] || continue
  PLUGIN_SRCS+=("$plugin_dir")
  PLUGIN_LINKS+=("$HOME/.claude/skills/$(basename "$plugin_dir")")
done

# Remove a symlink only if it points exactly to the expected target.
unlink_if_owned() {
  local dest="$1" src="$2"
  if [[ ! -L "$dest" ]]; then
    return 0
  fi
  local target
  target="$(readlink "$dest")"
  # Resolve a relative target to an absolute path so the comparison is
  # reliable regardless of how setup.sh recorded it.
  if [[ "$target" != /* ]]; then
    local link_dir
    link_dir="$(dirname "$dest")"
    target="$(cd "$link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")" || return 0
  fi
  if [[ "$target" != "$src" ]]; then
    return 0
  fi
  rm "$dest"
  echo "Removed symlink: $dest"
}

# Remove symlinks from a directory whose targets fall anywhere under src_dir.
unlink_dir_contents() {
  local dest_dir="$1" src_dir="$2"
  [[ -d "$dest_dir" ]] || return 0
  local entry target
  for entry in "$dest_dir"/*; do
    [[ -L "$entry" ]] || continue
    target="$(readlink "$entry")"
    if [[ "$target" != /* ]]; then
      local link_dir
      link_dir="$(dirname "$entry")"
      target="$(cd "$link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")" 2>/dev/null || continue
    fi
    if [[ "$target" == "$src_dir/"* ]]; then
      rm "$entry"
      echo "Removed symlink: $entry"
    fi
  done
}

# --------------------------------------------------------------------------
# Restore CLAUDE.md
# setup.sh moved the user's real CLAUDE.md to CLAUDE.personal.md and linked
# the repo's version in its place. Undo that: remove the repo symlink, then
# if CLAUDE.personal.md has content, move it back to CLAUDE.md. If it was
# created empty by setup.sh, remove it so ~/.claude/ is left clean.
restore_claude_md() {
  local link="$HOME/.claude/CLAUDE.md"
  local personal="$HOME/.claude/CLAUDE.personal.md"

  # Remove the repo symlink.
  unlink_if_owned "$link" "$REPO_ROOT/claude/CLAUDE.md"

  [[ -f "$personal" ]] || return 0

  if [[ -s "$personal" ]]; then
    # Non-empty personal file — it was the user's original CLAUDE.md before
    # setup.sh ran; move it back to restore the pre-setup state.
    if [[ -e "$link" ]]; then
      echo "Skipping restore: $link already exists (not a repo symlink)" >&2
    else
      mv "$personal" "$link"
      echo "Restored $personal → $link"
    fi
  else
    # Empty file — setup.sh created it as a placeholder; clean it up.
    rm "$personal"
    echo "Removed empty $personal (placeholder created by setup.sh)"
  fi
}

restore_claude_md

# Commands — each file under claude/commands/ was linked individually.
unlink_dir_contents "$HOME/.claude/commands" "$REPO_ROOT/claude/commands"

# Plugins — each directory under plugins/ was linked as a unit.
for i in "${!PLUGIN_LINKS[@]}"; do
  unlink_if_owned "${PLUGIN_LINKS[$i]}" "${PLUGIN_SRCS[$i]}"
done

echo "Done."
