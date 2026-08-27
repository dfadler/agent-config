#!/usr/bin/env bash
# Symlink this repo's config into each tool's own config directory (today:
# claude/ -> ~/.claude/). Safe to re-run: fixes symlinks that already point
# here, and reports (without touching) anything else already at the target.
#
# Usage: ./setup.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugins/dfadler-agent-config"
PLUGIN_LINK="$HOME/.claude/skills/dfadler-agent-config"

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

# Remove links this repo created that are no longer canonical. Two generations
# of those exist: earlier versions linked the plugin's skills and agents into
# ~/.claude/{skills,agents} one entry at a time (the plugin now supplies those
# itself, so a leftover would load the same skill twice), and the plugin used to
# be named generic-tools (that link is left dangling by the rename). Anything
# under these directories pointing into this repo's plugins/ that isn't the
# current plugin link is stale by definition.
#
# readlink reports the target exactly as stored, so a relative one has to be
# made absolute before it can be compared against $REPO_ROOT - otherwise a
# relative link into plugins/ reads as pointing elsewhere and survives, and the
# "isn't the current plugin link" test above can't recognize the current link
# either. Resolving the target's parent directory and re-appending the basename
# normalizes any leading ../ and works on a target that no longer exists, which
# realpath cannot do portably (macOS has no realpath -m). A target whose parent
# is also missing can't be placed, so it is left alone.
resolve_target() {
  local target="$1" link_dir="$2" parent
  if [[ "$target" == /* ]]; then
    printf '%s\n' "$target"
    return 0
  fi
  parent="$(cd "$link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)" || parent=""
  [[ -n "$parent" ]] || return 1
  printf '%s/%s\n' "$parent" "$(basename "$target")"
}

prune_stale_plugin_links() {
  local dest_dir="$1"
  [[ -d "$dest_dir" ]] || return 0
  local entry target resolved
  for entry in "$dest_dir"/*; do
    [[ -L "$entry" ]] || continue
    target="$(readlink "$entry")"
    resolved="$(resolve_target "$target" "$dest_dir")" || continue
    if [[ "$resolved" != "$REPO_ROOT/plugins/"* ]]; then
      continue
    fi
    if [[ "$entry" == "$PLUGIN_LINK" && "$resolved" == "$PLUGIN_SRC" ]]; then
      continue
    fi
    rm "$entry"
    echo "Removed superseded symlink: $entry -> $target"
  done
}

mkdir -p "$HOME/.claude"
link "$REPO_ROOT/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
link_dir_contents "$REPO_ROOT/claude/commands" "$HOME/.claude/commands"

prune_stale_plugin_links "$HOME/.claude/skills"
prune_stale_plugin_links "$HOME/.claude/agents"

# dfadler-agent-config is a plugin, so link the directory as a unit rather than
# its contents. Claude Code auto-loads any directory under ~/.claude/skills/
# that carries a .claude-plugin/plugin.json as "<name>@skills-dir", and it
# follows symlinks - so this keeps edits in this repo live (no
# install/update/restart cycle) while still getting plugin identity: a version,
# `claude plugin disable`, `claude plugin details` token accounting, `claude
# plugin validate`. The plugin's agents/ are discovered from inside it; don't
# link them separately. The link basename must match the manifest name so the
# skills it contains resolve as dfadler-agent-config:<skill>.
mkdir -p "$HOME/.claude/skills"
link "$PLUGIN_SRC" "$PLUGIN_LINK"
