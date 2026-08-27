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
    local target
    target="$(readlink "$dest")"
    if [[ "$target" == "$src" ]]; then
      return 0
    fi
    # Only take over a symlink this repo already owns, or one that is already
    # broken (harmless to replace, and the case you get after moving the repo).
    # ~/.claude/skills/ is shared with every other skills-dir plugin, so a live
    # symlink pointing elsewhere belongs to someone else - leave it for them.
    if [[ "$target" != "$REPO_ROOT/"* && -e "$dest" ]]; then
      echo "Skipping $dest — symlink to $target, which this repo doesn't own" >&2
      return 0
    fi
    echo "Replacing stale symlink: $dest -> $target"
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

# Remove symlinks that point into this repo at something no longer there. Two
# kinds accumulate: the per-entry skill and agent links older versions of this
# script fanned out (the plugin supplies those itself now, and a leftover would
# load the same skill twice), and the whole-plugin link under the plugin's
# previous name after a rename. Both are dangling once the checkout no longer
# has the path, which is the only test needed - a link this repo owns whose
# target is gone has no reason to stay. Live links are left alone, so the
# current plugin link survives a re-run, as does anything another plugin owns.
prune_stale_links() {
  local dest_dir="$1"
  [[ -d "$dest_dir" ]] || return 0
  local entry target
  for entry in "$dest_dir"/*; do
    [[ -L "$entry" && ! -e "$entry" ]] || continue
    target="$(readlink "$entry")"
    if [[ "$target" == "$REPO_ROOT/"* ]]; then
      rm "$entry"
      echo "Removed stale symlink: $entry -> $target"
    fi
  done
}

mkdir -p "$HOME/.claude"
link "$REPO_ROOT/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link_dir_contents "$REPO_ROOT/claude/commands" "$HOME/.claude/commands"

prune_stale_links "$HOME/.claude/skills"
prune_stale_links "$HOME/.claude/agents"

# dfadler-agent-config is a plugin, so link the directory as a unit rather than
# its contents. Claude Code auto-loads any directory under ~/.claude/skills/ that
# carries a .claude-plugin/plugin.json as "<name>@skills-dir", and it follows
# symlinks - so this keeps edits in this repo live (no install/update/restart
# cycle) while still getting plugin identity: a version, `claude plugin
# disable`, `claude plugin details` token accounting, `claude plugin validate`.
# The plugin's agents/ are discovered from inside it; don't link them separately.
mkdir -p "$HOME/.claude/skills"
link "$REPO_ROOT/plugins/dfadler-agent-config" \
  "$HOME/.claude/skills/dfadler-agent-config"
