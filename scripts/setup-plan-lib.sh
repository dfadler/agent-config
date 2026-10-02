#!/usr/bin/env bash
# sourced-only
# The decision half of setup.sh: works out WHAT an install run should do and
# prints it as plain, line-oriented data on stdout. It never writes, never
# touches the network, and never runs anything with side effects; it only
# reads the filesystem under $HOME and $REPO_ROOT. setup.sh sources this and
# applies the plan; `setup.sh --plan` prints it instead. Sourced only — do not
# run directly. Requires scripts/symlink-lib.sh, scripts/claude-md-lib.sh,
# scripts/plugin-hooks.sh and scripts/settings-lib.sh to be sourced first.
#
# Inputs (globals set by the caller):
#   REPO_ROOT       absolute path of this repo
#   HOME            the home directory whose ~/.claude is being installed into
#   SKIP_FEATURES   array of feature names (commands and plugins) to leave out
#   INCLUDE_SET     1 if the selection came from --include (only changes the
#                   wording of skip messages), anything else for --skip
#
# Plan line format: one action per line, fields separated by a single TAB, the
# first field is the verb. Paths may contain spaces but not tabs or newlines.
# An empty plan means the machine already matches the desired state.
#
#   mkdir             <dir>
#   personal-migrate  <current> <personal>   mv a hand-written CLAUDE.md aside
#   personal-create   <personal>             create the empty personal file
#   include           <ref>                  one @-include of the managed section
#   claude-md         <mode> <path>          write the managed section; mode is
#                                            create | replace-symlink | update |
#                                            prepend; preceded by its include lines
#   link              <src> <dest>           create a symlink
#   relink            <src> <dest> <old>     replace a stale symlink (old = target)
#   unlink            <reason> <path> <old>  remove a symlink; reason is
#                                            opted-out | superseded
#   register-hook     <event> <cmd> [matcher]    matcher omitted when empty
#   deregister-hook   <event> <cmd>
#   skip-plugin       <name> <reason>        informational: plugin left out
#   skip-command      <dest> <reason> <name> informational: command left out
#   warn-foreign-symlink <dest> <target>     informational: not ours, left alone
#   warn-exists          <dest>              informational: real file, left alone
#
# Informational lines (skip-*, warn-*) change nothing on disk; every other
# verb is an action. Keep this format simple and documented: a later
# TypeScript port of setup should be able to emit and consume it unchanged.

# is_skipped NAME: succeeds if NAME is in SKIP_FEATURES.
is_skipped() {
  local name="$1" f
  for f in ${SKIP_FEATURES[@]+"${SKIP_FEATURES[@]}"}; do
    [[ "$f" == "$name" ]] && return 0
  done
  return 1
}

# Wording for a feature this run leaves out: "--skip" when the user named it,
# "not in --include" when --include's complement excluded it.
exclude_reason() {
  if [[ "${INCLUDE_SET:-0}" == 1 ]]; then
    printf 'not in --include'
  else
    printf -- '--skip'
  fi
}

# Print the reference (path after the "@") of each include in the managed
# section: the personal-instructions file, this repo's CLAUDE.md, then one per
# entry in claude/conventions/DEFAULT_ENABLED (blank lines and comments
# skipped). Computed fresh so a moved repo or a changed manifest is handled by
# regenerating the whole section.
plan_include_refs() {
  printf 'CLAUDE.personal.md\n'
  printf '%s/claude/CLAUDE.md\n' "$REPO_ROOT"
  local manifest="$REPO_ROOT/claude/conventions/DEFAULT_ENABLED"
  [[ -f "$manifest" ]] || return 0
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%%#*}"
    line="${line## }"
    line="${line%% }"
    [[ -n "$line" ]] || continue
    printf '%s/claude/conventions/%s\n' "$REPO_ROOT" "$line"
  done <"$manifest"
}

# The managed-section body: one "@<ref>" line per include ref.
managed_section_body() {
  local ref
  while IFS= read -r ref; do
    printf '@%s\n' "$ref"
  done < <(plan_include_refs)
}

# Plugin directories (absolute, no trailing slash) this repo ships: any
# directory under plugins/ with a .claude-plugin/plugin.json.
plan_plugin_dirs() {
  local plugin_dir
  for plugin_dir in "$REPO_ROOT"/plugins/*/; do
    plugin_dir="${plugin_dir%/}"
    [[ -f "$plugin_dir/.claude-plugin/plugin.json" ]] || continue
    printf '%s\n' "$plugin_dir"
  done
}

plan_skipped_plugins() {
  local plugin_dir name
  while IFS= read -r plugin_dir; do
    name="$(basename "$plugin_dir")"
    if is_skipped "$name"; then
      printf 'skip-plugin\t%s\t%s\n' "$name" "$(exclude_reason)"
    fi
  done < <(plan_plugin_dirs)
}

# personal-file migration plus the managed-section write. Prints, in order:
# the personal action (if any), then the include lines and one claude-md line
# (if the generated file needs writing).
plan_claude_md() {
  local personal="$HOME/.claude/CLAUDE.personal.md"
  local current="$HOME/.claude/CLAUDE.md"
  local current_moved=0

  if [[ ! -e "$personal" ]]; then
    if [[ -f "$current" && ! -L "$current" ]]; then
      printf 'personal-migrate\t%s\t%s\n' "$current" "$personal"
      current_moved=1
    else
      printf 'personal-create\t%s\n' "$personal"
    fi
  fi

  local mode=""
  if [[ "$current_moved" == 0 && -L "$current" ]]; then
    mode="replace-symlink"
  elif [[ "$current_moved" == 1 || ! -e "$current" ]]; then
    mode="create"
  elif grep -qF "$MANAGED_BEGIN" "$current"; then
    local existing_body
    existing_body="$(sed -n "/^${MANAGED_BEGIN//\//\\/}\$/,/^${MANAGED_END//\//\\/}\$/p" "$current" | sed '1d;$d')"
    if [[ "$existing_body" != "$(managed_section_body)" ]]; then
      mode="update"
    fi
  else
    mode="prepend"
  fi

  if [[ -n "$mode" ]]; then
    local ref
    while IFS= read -r ref; do
      printf 'include\t%s\n' "$ref"
    done < <(plan_include_refs)
    printf 'claude-md\t%s\t%s\n' "$mode" "$current"
  fi
}

# plan_link SRC DEST [ASSUME_ABSENT]: the plan line (if any) for linking SRC at
# DEST. ASSUME_ABSENT=1 means an earlier plan line removes DEST first, so it is
# planned as if nothing were there.
plan_link() {
  local src="$1" dest="$2" assume_absent="${3:-0}"
  if [[ "$assume_absent" != 1 ]]; then
    if [[ -L "$dest" ]]; then
      local target
      target="$(readlink "$dest")"
      if [[ "$target" == "$src" ]]; then
        return 0
      fi
      # Only take over a symlink this repo already owns, or one that is
      # already broken. ~/.claude/skills/ is shared with every other
      # skills-dir plugin, so a live symlink pointing elsewhere is theirs.
      if [[ "$target" != "$REPO_ROOT/"* && -e "$dest" ]]; then
        printf 'warn-foreign-symlink\t%s\t%s\n' "$dest" "$target"
        return 0
      fi
      printf 'relink\t%s\t%s\t%s\n' "$src" "$dest" "$target"
      return 0
    elif [[ -e "$dest" ]]; then
      printf 'warn-exists\t%s\n' "$dest"
      return 0
    fi
  fi
  printf 'link\t%s\t%s\n' "$src" "$dest"
}

# mkdir plan line, only when the directory is missing.
plan_mkdir() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    printf 'mkdir\t%s\n' "$dir"
  fi
}

# Link each entry of SRC_DIR into DEST_DIR, except the excluded features.
plan_dir_contents() {
  local src_dir="$1" dest_dir="$2"
  plan_mkdir "$dest_dir"
  local entry name feature
  for entry in "$src_dir"/*; do
    [[ -e "$entry" ]] || continue
    name="$(basename "$entry")"
    # Feature name = basename minus a .md suffix (this is only used for
    # commands/, whose names are built the same way in setup.sh).
    feature="${name%.md}"
    if is_skipped "$feature"; then
      printf 'skip-command\t%s\t%s\t%s\n' "$dest_dir/$name" "$(exclude_reason)" "$feature"
      continue
    fi
    plan_link "$entry" "$dest_dir/$name"
  done
}

# Unlink symlinks into SRC_DIR whose feature is now excluded (opted out after
# an earlier run linked it). Foreign symlinks and real files are left alone.
plan_prune_opted_out() {
  local dest_dir="$1" src_dir="$2"
  [[ -d "$dest_dir" ]] || return 0
  local entry target resolved name feature
  for entry in "$dest_dir"/*; do
    [[ -L "$entry" ]] || continue
    target="$(readlink "$entry")"
    resolved="$(resolve_symlink_target "$target" "$dest_dir")" || continue
    [[ "$resolved" == "$src_dir/"* ]] || continue
    name="$(basename "$entry")"
    feature="${name%.md}"
    is_skipped "$feature" || continue
    printf 'unlink\topted-out\t%s\t%s\n' "$entry" "$target"
  done
}

# plan_plugin_link_is_stale ENTRY DIR: succeeds if ENTRY (a symlink in DIR)
# points into this repo's plugins/ but is not the current link for a plugin
# that is staying installed, i.e. the stale-link prune removes it.
plan_plugin_link_is_stale() {
  local entry="$1" dest_dir="$2"
  [[ -L "$entry" ]] || return 1
  local target resolved plugin_dir
  target="$(readlink "$entry")"
  resolved="$(resolve_symlink_target "$target" "$dest_dir")" || return 1
  [[ "$resolved" == "$REPO_ROOT/plugins/"* ]] || return 1
  while IFS= read -r plugin_dir; do
    is_skipped "$(basename "$plugin_dir")" && continue
    if [[ "$entry" == "$HOME/.claude/skills/$(basename "$plugin_dir")" && "$resolved" == "$plugin_dir" ]]; then
      return 1
    fi
  done < <(plan_plugin_dirs)
  return 0
}

# Unlink links this repo created that are no longer canonical: per-skill and
# per-agent links from earlier versions, and the old generic-tools name. Also
# covers a plugin opted out since an earlier run.
plan_prune_stale_plugin_links() {
  local dest_dir="$1"
  [[ -d "$dest_dir" ]] || return 0
  local entry
  for entry in "$dest_dir"/*; do
    if plan_plugin_link_is_stale "$entry" "$dest_dir"; then
      printf 'unlink\tsuperseded\t%s\t%s\n' "$entry" "$(readlink "$entry")"
    fi
  done
}

plan_plugin_links() {
  local plugin_dir name dest assume_absent
  while IFS= read -r plugin_dir; do
    name="$(basename "$plugin_dir")"
    is_skipped "$name" && continue
    dest="$HOME/.claude/skills/$name"
    assume_absent=0
    # The stale-link prune above removes this dest first when it is stale.
    if plan_plugin_link_is_stale "$dest" "$HOME/.claude/skills"; then
      assume_absent=1
    fi
    plan_link "$plugin_dir" "$dest" "$assume_absent"
  done < <(plan_plugin_dirs)
}

# Hook registration. Each hook's current state comes from hook_registration_state
# (scripts/settings-lib.sh): 0 registered, 1 not, 2 cannot tell (no python3),
# in which case the action is still planned so the applier reports it.
plan_hooks() {
  local settings="$HOME/.claude/settings.json" i rc
  for i in "${!PLUGIN_HOOK_EVENTS[@]}"; do
    rc=0
    hook_registration_state "${PLUGIN_HOOK_EVENTS[$i]}" "${PLUGIN_HOOK_CMDS[$i]}" "$settings" || rc=$?
    if ! is_skipped "${PLUGIN_HOOK_FEATURES[$i]}"; then
      if [[ "$rc" != 0 ]]; then
        if [[ -n "${PLUGIN_HOOK_MATCHERS[$i]}" ]]; then
          printf 'register-hook\t%s\t%s\t%s\n' "${PLUGIN_HOOK_EVENTS[$i]}" \
            "${PLUGIN_HOOK_CMDS[$i]}" "${PLUGIN_HOOK_MATCHERS[$i]}"
        else
          printf 'register-hook\t%s\t%s\n' "${PLUGIN_HOOK_EVENTS[$i]}" "${PLUGIN_HOOK_CMDS[$i]}"
        fi
      fi
    elif [[ "$rc" != 1 ]]; then
      printf 'deregister-hook\t%s\t%s\n' "${PLUGIN_HOOK_EVENTS[$i]}" "${PLUGIN_HOOK_CMDS[$i]}"
    fi
  done
}

# The whole install plan, in the order it must be applied.
plan_install() {
  plan_skipped_plugins
  plan_mkdir "$HOME/.claude"
  plan_claude_md
  plan_dir_contents "$REPO_ROOT/claude/commands" "$HOME/.claude/commands"
  plan_prune_opted_out "$HOME/.claude/commands" "$REPO_ROOT/claude/commands"
  plan_prune_stale_plugin_links "$HOME/.claude/skills"
  plan_prune_stale_plugin_links "$HOME/.claude/agents"
  plan_mkdir "$HOME/.claude/skills"
  plan_plugin_links
  plan_hooks
}
