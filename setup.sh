#!/usr/bin/env bash
# Symlink this repo's config into each tool's own config directory (today:
# claude/ -> ~/.claude/). Safe to re-run: fixes symlinks that already point
# here, and reports (without touching) anything else already at the target.
#
# Usage: ./setup.sh [--install-deps]

set -euo pipefail

INSTALL_DEPS=0

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--install-deps]

Symlinks this repo's config into ~/.claude, then checks that the runtime
dependencies the linked skills need are importable by the interpreter that
will actually run them.

  --install-deps   Also install a missing dependency (python3 -m pip install
                   --user pyte), when the interpreter allows it.
  -h, --help       Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Markers that delimit the block setup.sh writes into ~/.claude/CLAUDE.md.
# teardown.sh carries an identical copy — both must stay in sync.
MANAGED_BEGIN="# >>> agent-config managed begin <<<"
MANAGED_END="# >>> agent-config managed end <<<"

# Every directory under plugins/ that carries a .claude-plugin/plugin.json is a
# plugin this repo ships (currently dfadler-agent-config, bulletproof-react-skills,
# and accessibility-skills) - discovered rather than hardcoded so adding one
# doesn't require touching this list by hand. The trailing "/" restricts the
# glob to directories; if plugins/ is ever empty the pattern itself fails the
# -f test below and the loop body never runs, so no nullglob/-e guard is needed.
PLUGIN_SRCS=()
PLUGIN_LINKS=()
for plugin_dir in "$REPO_ROOT"/plugins/*/; do
  plugin_dir="${plugin_dir%/}"
  [[ -f "$plugin_dir/.claude-plugin/plugin.json" ]] || continue
  PLUGIN_SRCS+=("$plugin_dir")
  PLUGIN_LINKS+=("$HOME/.claude/skills/$(basename "$plugin_dir")")
done

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
# of those exist: earlier versions linked dfadler-agent-config's skills and
# agents into ~/.claude/{skills,agents} one entry at a time (each plugin now
# supplies those itself, so a leftover would load the same skill twice), and
# dfadler-agent-config used to be named generic-tools (that link is left
# dangling by the rename). Anything under these directories pointing into this
# repo's plugins/ that isn't one of the current plugin links (PLUGIN_LINKS) is
# stale by definition.
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
  local entry target resolved i keep
  for entry in "$dest_dir"/*; do
    [[ -L "$entry" ]] || continue
    target="$(readlink "$entry")"
    resolved="$(resolve_target "$target" "$dest_dir")" || continue
    if [[ "$resolved" != "$REPO_ROOT/plugins/"* ]]; then
      continue
    fi
    keep=0
    for i in "${!PLUGIN_LINKS[@]}"; do
      if [[ "$entry" == "${PLUGIN_LINKS[$i]}" && "$resolved" == "${PLUGIN_SRCS[$i]}" ]]; then
        keep=1
        break
      fi
    done
    [[ "$keep" == 1 ]] && continue
    rm "$entry"
    echo "Removed superseded symlink: $entry -> $target"
  done
}

# Migrate an existing hand-maintained ~/.claude/CLAUDE.md to CLAUDE.personal.md
# so it loads before the repo's symlinked version via the @CLAUDE.personal.md
# directive in claude/CLAUDE.md. Called before `link` touches CLAUDE.md so the
# personal file is always present when @CLAUDE.personal.md resolves at runtime.
migrate_personal_claude_md() {
  local personal="$HOME/.claude/CLAUDE.personal.md"
  local current="$HOME/.claude/CLAUDE.md"

  if [[ ! -e "$personal" ]]; then
    if [[ -f "$current" && ! -L "$current" ]]; then
      # A real (non-symlink) file exists — move it to the personal slot.
      mv "$current" "$personal"
      echo "Migrated $current → $personal (personal instructions preserved there)"
    else
      # Either nothing is there yet, or it's already a symlink this script will
      # handle via link(). Create an empty personal file so @CLAUDE.personal.md
      # in the repo's CLAUDE.md always resolves rather than erroring. The
      # sidecar marks it as setup-owned so teardown.sh can safely remove it
      # without risking a user-owned empty file with the same name.
      touch "$personal" "${personal}.setup-managed"
      echo "Created empty $personal (add machine-specific instructions there)"
    fi
  fi

}

# Print the managed-section body (everything between, not including, the
# BEGIN/END markers): the personal-instructions include, this repo's CLAUDE.md,
# then one @include per entry in claude/conventions/DEFAULT_ENABLED (skipping
# blank lines and comments). Computed fresh each call so both "repo moved" and
# "DEFAULT_ENABLED changed" are handled by regenerating the whole section,
# rather than patching one line in place.
managed_section_body() {
  printf '@CLAUDE.personal.md\n'
  printf '@%s/claude/CLAUDE.md\n' "$REPO_ROOT"
  local manifest="$REPO_ROOT/claude/conventions/DEFAULT_ENABLED"
  [[ -f "$manifest" ]] || return 0
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line## }"
    line="${line%% }"
    [[ -n "$line" ]] || continue
    printf '@%s/claude/conventions/%s\n' "$REPO_ROOT" "$line"
  done <"$manifest"
}

# Write a thin host-local ~/.claude/CLAUDE.md whose managed section @-includes
# the user's personal instructions, this repo's CLAUDE.md, and the default set
# of convention files. Using a generated regular file rather than a symlink
# keeps the repo's working tree clean: any tool that writes to
# ~/.claude/CLAUDE.md modifies only the host-local generated file, never a
# tracked repo file.
#
# Safe to re-run:
#   • If the file is a legacy symlink to this repo, replace it.
#   • If the file already has our managed section, replace its body with the
#     freshly computed one (repo moved, or DEFAULT_ENABLED changed) and leave
#     user additions below the section intact.
#   • If the file exists without our section, prepend the section and keep
#     the user's existing content below it.
#   • If the file doesn't exist, create it.
ensure_claude_md_includes() {
  local claude_md="$HOME/.claude/CLAUDE.md"
  local body
  body="$(managed_section_body)"

  if [[ -L "$claude_md" ]]; then
    # Legacy format: symlink to our repo. Replace with generated file.
    rm "$claude_md"
    printf '%s\n%s\n%s\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END" >"$claude_md"
    echo "Replaced repo symlink with generated $claude_md"
    return 0
  fi

  if [[ ! -e "$claude_md" ]]; then
    printf '%s\n%s\n%s\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END" >"$claude_md"
    echo "Created $claude_md"
    return 0
  fi

  if grep -qF "$MANAGED_BEGIN" "$claude_md"; then
    # Our section is present. If its body already matches, nothing to do.
    local existing_body
    existing_body="$(sed -n "/^${MANAGED_BEGIN//\//\\/}\$/,/^${MANAGED_END//\//\\/}\$/p" "$claude_md" | sed '1d;$d')"
    if [[ "$existing_body" == "$body" ]]; then
      return 0
    fi
    # Body differs (repo moved, or DEFAULT_ENABLED changed): replace it.
    local tmp in_section=0
    tmp="$(mktemp)"
    while IFS= read -r rawline || [[ -n "$rawline" ]]; do
      if [[ "$rawline" == "$MANAGED_BEGIN" ]]; then
        printf '%s\n%s\n%s\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END" >>"$tmp"
        in_section=1
        continue
      fi
      if [[ "$rawline" == "$MANAGED_END" ]]; then
        in_section=0
        continue
      fi
      [[ "$in_section" == 1 ]] && continue
      printf '%s\n' "$rawline" >>"$tmp"
    done <"$claude_md"
    mv "$tmp" "$claude_md"
    echo "Updated managed section in $claude_md"
  else
    # No section yet: prepend, keeping user content below.
    local tmp
    tmp="$(mktemp)"
    {
      printf '%s\n%s\n%s\n\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END"
      cat "$claude_md"
    } >"$tmp"
    mv "$tmp" "$claude_md"
    echo "Prepended managed section to $claude_md"
  fi
}

mkdir -p "$HOME/.claude"
migrate_personal_claude_md
ensure_claude_md_includes
link_dir_contents "$REPO_ROOT/claude/commands" "$HOME/.claude/commands"

prune_stale_plugin_links "$HOME/.claude/skills"
prune_stale_plugin_links "$HOME/.claude/agents"

# Each plugin under plugins/ is linked as a unit rather than its contents.
# Claude Code auto-loads any directory under ~/.claude/skills/ that carries a
# .claude-plugin/plugin.json as "<name>@skills-dir", and it follows symlinks -
# so this keeps edits in this repo live (no install/update/restart cycle)
# while still getting plugin identity: a version, `claude plugin disable`,
# `claude plugin details` token accounting, `claude plugin validate`. Each
# plugin's agents/ are discovered from inside it; don't link them separately.
# The link basename must match its manifest's name so its skills resolve as
# <plugin-name>:<skill>.
mkdir -p "$HOME/.claude/skills"
for i in "${!PLUGIN_SRCS[@]}"; do
  link "${PLUGIN_SRCS[$i]}" "${PLUGIN_LINKS[$i]}"
done

# Last, so the linking work is already done and reported when these speak up.
# Advisory checks (git identity, pyte, companion plugins/tools, Aikido Safe
# Chain permission offer) are extracted into scripts/check-companions.sh.
# An explicitly requested --install-deps that doesn't install is still a failure.
if [[ "$INSTALL_DEPS" == "1" ]]; then
  "$REPO_ROOT/scripts/check-companions.sh" --install-deps
else
  "$REPO_ROOT/scripts/check-companions.sh"
fi
