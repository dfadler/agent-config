#!/usr/bin/env bash
# Undo setup.sh: remove this repo's symlinks from ~/.claude/ and restore
# ~/.claude/CLAUDE.md from ~/.claude/CLAUDE.personal.md.
#
# Safe to re-run: only touches symlinks that point into this repo; skips
# anything that has already been removed.
#
# Usage: ./teardown.sh [--commands] [--plugins] [--claude-md]

set -euo pipefail

EXIT_OK=0
EXIT_USAGE=2

usage() {
  cat <<'USAGE'
Usage: ./teardown.sh [--commands] [--plugins] [--claude-md]

Removes this repo's symlinks from ~/.claude and restores ~/.claude/CLAUDE.md
from ~/.claude/CLAUDE.personal.md (the inverse of setup.sh). With no flags,
does the full teardown. Pass one or more flags to remove only that part;
flags are combinable.

  --commands    Only unlink ~/.claude/commands/* entries pointing into this repo.
  --plugins     Only unlink ~/.claude/skills/* entries pointing into this repo's plugins/.
  --claude-md   Only restore ~/.claude/CLAUDE.md / CLAUDE.personal.md.
  -h, --help    Show this message and exit.
USAGE
}

DO_COMMANDS=0
DO_PLUGINS=0
DO_CLAUDE_MD=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h | --help)
      usage
      exit "$EXIT_OK"
      ;;
    --commands)
      DO_COMMANDS=1
      ;;
    --plugins)
      DO_PLUGINS=1
      ;;
    --claude-md)
      DO_CLAUDE_MD=1
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit "$EXIT_USAGE"
      ;;
  esac
  shift
done

# No flags given: full teardown (backwards compatible).
if [[ "$DO_COMMANDS" -eq 0 && "$DO_PLUGINS" -eq 0 && "$DO_CLAUDE_MD" -eq 0 ]]; then
  DO_COMMANDS=1
  DO_PLUGINS=1
  DO_CLAUDE_MD=1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/claude-md-lib.sh
source "$REPO_ROOT/scripts/claude-md-lib.sh"
# shellcheck source=scripts/settings-lib.sh
source "$REPO_ROOT/scripts/settings-lib.sh"

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
# Handles two formats left by setup.sh:
#   • Legacy (symlink): remove the repo symlink.
#   • Current (generated file): strip the managed section; leave user
#     additions below it intact.
# Then, if CLAUDE.personal.md has content, move it back to CLAUDE.md. If
# setup.sh created an empty placeholder (marked by a .setup-managed sidecar),
# remove both. A user-owned empty file with no sidecar is left untouched.
restore_claude_md() {
  local link="$HOME/.claude/CLAUDE.md"
  local personal="$HOME/.claude/CLAUDE.personal.md"
  local marker="${personal}.setup-managed"

  if [[ -L "$link" ]]; then
    # Legacy format: symlink. Remove only if it points to our repo.
    unlink_if_owned "$link" "$REPO_ROOT/claude/CLAUDE.md"
  elif [[ -f "$link" ]] && grep -qF "$MANAGED_BEGIN" "$link" 2>/dev/null; then
    # Current format: generated regular file. Strip managed section.
    local tmp in_section=0
    tmp="$(mktemp)"
    while IFS= read -r rawline || [[ -n "$rawline" ]]; do
      if [[ "$rawline" == "$MANAGED_BEGIN" ]]; then
        in_section=1
        continue
      fi
      if [[ "$rawline" == "$MANAGED_END" ]]; then
        in_section=0
        continue
      fi
      [[ "$in_section" == 1 ]] && continue
      printf '%s\n' "$rawline" >> "$tmp"
    done < "$link"
    # Drop leading blank lines left after removing the managed section.
    local trimmed
    trimmed="$(sed '/./,$!d' "$tmp")"
    rm "$tmp"
    if [[ -z "$trimmed" ]]; then
      rm "$link"
      echo "Removed empty $link"
    else
      printf '%s\n' "$trimmed" > "$link"
      echo "Removed managed section from $link"
    fi
  fi

  [[ -f "$personal" ]] || return 0

  if [[ -s "$personal" ]]; then
    # Non-empty personal file — it was the user's original CLAUDE.md before
    # setup.sh ran; move it back to restore the pre-setup state.
    if [[ -e "$link" || -L "$link" ]]; then
      echo "Skipping restore: $link already exists" >&2
    else
      mv "$personal" "$link"
      rm -f "$marker"
      echo "Restored $personal → $link"
    fi
  elif [[ -f "$marker" ]]; then
    # Empty placeholder setup.sh created — remove both the file and the marker.
    rm "$personal" "$marker"
    echo "Removed empty $personal (placeholder created by setup.sh)"
  fi
  # A user-owned empty CLAUDE.personal.md without a marker is left untouched.
}

[[ "$DO_CLAUDE_MD" -eq 1 ]] && restore_claude_md

# Commands — each file under claude/commands/ was linked individually.
if [[ "$DO_COMMANDS" -eq 1 ]]; then
  unlink_dir_contents "$HOME/.claude/commands" "$REPO_ROOT/claude/commands"
fi

if [[ "$DO_PLUGINS" -eq 1 ]]; then
  # Plugins — any symlink in ~/.claude/skills/ pointing into this repo's
  # plugins/ directory, including links to plugins no longer in the checkout.
  unlink_dir_contents "$HOME/.claude/skills" "$REPO_ROOT/plugins"

  # Deregister plugin hooks from ~/.claude/settings.json that setup.sh wired in.
  GLOBAL_SETTINGS="$HOME/.claude/settings.json"
  WORKTREE_HOOK_CMD="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  ensure_hook_deregistered "PreToolUse" "$WORKTREE_HOOK_CMD" "$GLOBAL_SETTINGS"
fi

echo "Done."
