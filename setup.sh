#!/usr/bin/env bash
# Symlink this repo's config into each tool's own config directory (today:
# claude/ -> ~/.claude/). Safe to re-run: fixes symlinks that already point
# here, and reports (without touching) anything else already at the target.
#
# Usage: ./setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

link() {
  local src="$1" dest="$2"
  if [[ -L "$dest" ]]; then
    if [[ "$(readlink "$dest")" == "$src" ]]; then
      return 0
    fi
    echo "Replacing stale symlink: $dest"
    rm "$dest"
  elif [[ -e "$dest" ]]; then
    echo "Skipping $dest — already exists and isn't a symlink to this repo" >&2
    return 0
  fi
  ln -s "$src" "$dest"
  echo "Linked $dest -> $src"
}

link_dir_contents() {
  local src_dir="$1" dest_dir="$2"
  mkdir -p "$dest_dir"
  local entry
  for entry in "$src_dir"/*; do
    [[ -e "$entry" ]] || continue
    link "$entry" "$dest_dir/$(basename "$entry")"
  done
}

mkdir -p "$HOME/.claude"
link "$REPO_ROOT/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link_dir_contents "$REPO_ROOT/claude/commands" "$HOME/.claude/commands"
# Agents and skills moved under plugins/generic-tools/ when this repo became a
# plugin marketplace (commit 89a34ce) - claude/agents and claude/skills no
# longer exist.
link_dir_contents "$REPO_ROOT/plugins/generic-tools/agents" "$HOME/.claude/agents"
link_dir_contents "$REPO_ROOT/plugins/generic-tools/skills" "$HOME/.claude/skills"
