#!/usr/bin/env bash
# Symlink this repo's config into each tool's own config directory (today:
# claude/ -> ~/.claude/). Safe to re-run: fixes symlinks that already point
# here, and reports (without touching) anything else already at the target.
#
# Usage: ./setup.sh [--install-deps] [--fix] [--skip=<feature,...>] [--include=<feature,...>] [--list-features] [--no-companions] [--plan]
#
# Structure: scripts/setup-plan-lib.sh decides what to do and prints it as plan
# lines (pure: reads state, writes nothing); the applier below executes them.

set -euo pipefail

INSTALL_DEPS=0
FIX=0
NO_COMPANIONS=0
DRY_RUN=0
SKIP_LIST=""
INCLUDE_LIST=""
INCLUDE_SET=0
LIST_FEATURES=0

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--install-deps] [--skip=<feature,...>] [--include=<feature,...>] [--list-features] [--plan]

Symlinks this repo's config into ~/.claude, then checks that the runtime
dependencies the linked skills need are importable by the interpreter that
will actually run them.

With neither --skip nor --include, every command and every plugin is
installed — the same all-or-nothing behavior this script has always had.
--skip opts specific features out (everything not named stays in);
--include opts specific features in (everything not named stays out). The
two are opposite selections over the same names, so combining them in one
run is rejected rather than guessing which one wins.

  --install-deps     Also install a missing dependency (python3 -m pip
                     install --user pyte), when the interpreter allows it, and
                     playwright-cli (npm install -g @playwright/cli, Node 22).
  --fix              Also apply other known fixes the companion checks
                     detect, instead of only reporting them (currently: rtk's
                     exclude_commands config — see docs/companion-plugins.md).
                     Forwarded to scripts/check-companions.sh; never runs as
                     a side effect of a bare invocation.
  --skip=<list>      Comma-separated feature names to leave unlinked (and
                     to unlink if a previous run linked them). A feature is
                     either a slash command's basename (e.g. "adversarial-
                     review", from claude/commands/adversarial-review.md)
                     or a plugin directory name (e.g. "dfadler-agent-config",
                     from plugins/dfadler-agent-config/) — skipping a plugin
                     removes it as a whole (skills, agents, and hooks
                     together; hooks also stay off by default per-project
                     regardless — see docs/hook-composition.md). Run with
                     --list-features to see the available names.
  --include=<list>   Comma-separated feature names to install (same names
                     --skip accepts); every feature not named is left
                     unlinked, and unlinked if a previous run linked it.
                     At least one non-empty name is required — "--include"
                     with nothing after the "=" is rejected rather than
                     silently installing everything. Cannot be combined
                     with --skip.
  --list-features    Print the feature names --skip and --include accept
                     and exit without linking anything.
  --plan, --dry-run  Print what this run would do, one tab-separated action
                     per line (format: scripts/setup-plan-lib.sh), and exit
                     without changing anything. Combines with --skip and
                     --include. An empty plan means nothing needs doing.
  --no-companions    Skip the advisory companion checks (git identity, pyte,
                     companion plugins). Linking still runs normally; only the
                     check-companions.sh step is omitted.
  -h, --help         Show this message and exit.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-deps) INSTALL_DEPS=1 ;;
    --fix) FIX=1 ;;
    --no-companions) NO_COMPANIONS=1 ;;
    --plan | --dry-run) DRY_RUN=1 ;;
    --skip=*) SKIP_LIST="${1#--skip=}" ;;
    --include=*)
      INCLUDE_LIST="${1#--include=}"
      INCLUDE_SET=1
      ;;
    --list-features) LIST_FEATURES=1 ;;
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

if [[ -n "$SKIP_LIST" && "$INCLUDE_SET" == 1 ]]; then
  echo "--skip and --include cannot be combined." >&2
  usage >&2
  exit 2
fi

REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --skip's and --include's values, each split on commas into an array.
# Declared even when empty so `set -u` never trips on ${arr[@]} below —
# bash's automatic expansion of an empty array is fine under nounset in
# modern bash, but the macOS-shipped bash (3.2) this repo has to stay
# compatible with does not reliably agree, so every use below goes through
# the ${arr[@]+"${arr[@]}"} guard used throughout this repo's shell
# scripts.
SKIP_FEATURES=()
if [[ -n "$SKIP_LIST" ]]; then
  IFS=',' read -r -a SKIP_FEATURES <<<"$SKIP_LIST"
fi

INCLUDE_FEATURES=()
if [[ "$INCLUDE_SET" == 1 ]]; then
  IFS=',' read -r -a INCLUDE_FEATURES <<<"$INCLUDE_LIST"
fi

# --include's value, unlike --skip's, isn't harmless when empty: --skip=
# (or no --skip at all) already means "everything installs," so an empty
# skip list is a no-op consistent with the default. --include= means the
# opposite (nothing named -> nothing installed), so silently treating it as
# "no restriction" would flip that into installing everything -- the
# opposite of what passing --include at all signals intent to do. Reject it
# before any filesystem operation. A delimiter-only value ("--include=,,,")
# already fails downstream via the unknown-feature check below (each empty
# element matches no known name), but this catches the plain-empty case
# that check never sees, since IFS splitting of "" produces zero elements
# rather than one empty one.
if [[ "$INCLUDE_SET" == 1 ]]; then
  include_name_found=0
  for name in ${INCLUDE_FEATURES[@]+"${INCLUDE_FEATURES[@]}"}; do
    [[ -n "$name" ]] && include_name_found=1 && break
  done
  if [[ "$include_name_found" == 0 ]]; then
    echo "--include requires at least one feature name." >&2
    usage >&2
    exit 2
  fi
fi

# Feature names --skip and --include accept: every plugin's directory name,
# plus every slash command's basename (without .md). Discovered rather than
# hardcoded, same reasoning as PLUGIN_SRCS below — a new plugin or command
# becomes selectable the moment it lands, with nothing here to update by
# hand.
COMMAND_NAMES=()
if [[ -d "$REPO_ROOT/claude/commands" ]]; then
  for entry in "$REPO_ROOT"/claude/commands/*; do
    [[ -f "$entry" ]] || continue
    COMMAND_NAMES+=("$(basename "$entry" .md)")
  done
fi

PLUGIN_ALL_NAMES=()
for plugin_dir in "$REPO_ROOT"/plugins/*/; do
  plugin_dir="${plugin_dir%/}"
  [[ -f "$plugin_dir/.claude-plugin/plugin.json" ]] || continue
  PLUGIN_ALL_NAMES+=("$(basename "$plugin_dir")")
done

if [[ "$LIST_FEATURES" == "1" ]]; then
  echo "Commands:"
  printf '  %s\n' ${COMMAND_NAMES[@]+"${COMMAND_NAMES[@]}"}
  echo "Plugins:"
  printf '  %s\n' ${PLUGIN_ALL_NAMES[@]+"${PLUGIN_ALL_NAMES[@]}"}
  exit 0
fi

# Fail fast on a typo'd --skip/--include name, before anything on disk is
# touched — same posture as the unknown-argument case above. Without this, a
# typo'd --skip name would silently install everything (the opposite of what
# was asked), and a typo'd --include name would silently install nothing.
# --skip and --include were already rejected together above, so at most one
# of SKIP_FEATURES/INCLUDE_FEATURES is non-empty here.
UNKNOWN_FLAG="--skip"
selected=(${SKIP_FEATURES[@]+"${SKIP_FEATURES[@]}"})
if [[ "$INCLUDE_SET" == 1 ]]; then
  UNKNOWN_FLAG="--include"
  selected=(${INCLUDE_FEATURES[@]+"${INCLUDE_FEATURES[@]}"})
fi
unknown_selected=()
for name in ${selected[@]+"${selected[@]}"}; do
  found=0
  for known in ${COMMAND_NAMES[@]+"${COMMAND_NAMES[@]}"} ${PLUGIN_ALL_NAMES[@]+"${PLUGIN_ALL_NAMES[@]}"}; do
    [[ "$known" == "$name" ]] && found=1 && break
  done
  [[ "$found" == 1 ]] || unknown_selected+=("$name")
done
if [[ ${#unknown_selected[@]} -gt 0 ]]; then
  echo "Unknown $UNKNOWN_FLAG feature(s): ${unknown_selected[*]}" >&2
  echo "Run './setup.sh --list-features' to see available names." >&2
  exit 2
fi

# --include is the positive form of the same selection --skip makes
# negatively. Rather than teach every downstream consumer (is_skipped,
# link_dir_contents, prune_skipped_dir_links, the PLUGIN_SRCS loop) a second
# "is it included" concept, --include is turned into its equivalent --skip
# list right here — every known feature *not* named by --include — so
# everything below only ever has to reason about SKIP_FEATURES. --skip and
# --include were already rejected together above, so this never overwrites a
# user-supplied SKIP_FEATURES.
if [[ "$INCLUDE_SET" == 1 ]]; then
  SKIP_FEATURES=()
  for known in ${COMMAND_NAMES[@]+"${COMMAND_NAMES[@]}"} ${PLUGIN_ALL_NAMES[@]+"${PLUGIN_ALL_NAMES[@]}"}; do
    included=0
    for name in "${INCLUDE_FEATURES[@]}"; do
      [[ "$known" == "$name" ]] && included=1 && break
    done
    [[ "$included" == 1 ]] || SKIP_FEATURES+=("$known")
  done
fi

# Markers that delimit the block setup.sh writes into ~/.claude/CLAUDE.md,
# and that teardown.sh strips back out — single source of truth.
# shellcheck source=scripts/claude-md-lib.sh
source "$REPO_ROOT/scripts/claude-md-lib.sh"
# Helpers for adding/removing hook entries in ~/.claude/settings.json.
# shellcheck source=scripts/settings-lib.sh
source "$REPO_ROOT/scripts/settings-lib.sh"
# The hook (event, matcher, feature, command) table both setup.sh and
# teardown.sh iterate — single source of truth for the command paths.
# shellcheck source=scripts/plugin-hooks.sh
source "$REPO_ROOT/scripts/plugin-hooks.sh"
# Shared relative-symlink-to-absolute-path resolution.
# shellcheck source=scripts/symlink-lib.sh
source "$REPO_ROOT/scripts/symlink-lib.sh"
# The decision half of this script: works out what to do and prints it as a
# line-oriented plan (format documented in the library), without writing.
# shellcheck source=scripts/setup-plan-lib.sh
source "$REPO_ROOT/scripts/setup-plan-lib.sh"

# ---------------------------------------------------------------------------
# The applier: executes plan lines, one verb each. It makes no decisions; every
# check about what is already present lives in scripts/setup-plan-lib.sh.
# ---------------------------------------------------------------------------

# Write the generated ~/.claude/CLAUDE.md. MODE comes from the plan;
# INCLUDE_REFS holds the plan's include lines (without the "@").
#   create          the file is absent: write the managed section
#   replace-symlink a legacy symlink to this repo: replace it with the section
#   update          our section is present but stale: replace its body, keep
#                   user additions below it
#   prepend         the file has no section: prepend it, keep the user's content
# Using a generated regular file rather than a symlink keeps the repo's working
# tree clean: any tool that writes to ~/.claude/CLAUDE.md modifies only the
# host-local generated file, never a tracked repo file.
apply_claude_md() {
  local mode="$1" claude_md="$2"
  local body ref
  body=""
  for ref in ${INCLUDE_REFS[@]+"${INCLUDE_REFS[@]}"}; do
    body="${body:+$body$'\n'}@$ref"
  done

  case "$mode" in
    replace-symlink)
      rm "$claude_md"
      printf '%s\n%s\n%s\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END" >"$claude_md"
      echo "Replaced repo symlink with generated $claude_md"
      ;;
    create)
      printf '%s\n%s\n%s\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END" >"$claude_md"
      echo "Created $claude_md"
      ;;
    update)
      local tmp in_section=0 rawline
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
      ;;
    prepend)
      local tmp
      tmp="$(mktemp)"
      {
        printf '%s\n%s\n%s\n\n' "$MANAGED_BEGIN" "$body" "$MANAGED_END"
        cat "$claude_md"
      } >"$tmp"
      mv "$tmp" "$claude_md"
      echo "Prepended managed section to $claude_md"
      ;;
    *)
      echo "Unknown claude-md mode in plan: $mode" >&2
      exit 20
      ;;
  esac
}

# apply_plan: read plan lines on stdin and execute them in order.
apply_plan() {
  local verb a b c
  INCLUDE_REFS=()
  while IFS=$'\t' read -r verb a b c; do
    case "$verb" in
      "") ;;
      skip-plugin) echo "Skipping plugin ($b): $a" ;;
      skip-command) echo "Skipping $a ($b: $c)" ;;
      warn-foreign-symlink)
        echo "Skipping $a — symlink to $b, which this repo doesn't own" >&2
        ;;
      warn-exists)
        echo "Skipping $a — already exists and isn't a symlink to this repo" >&2
        ;;
      mkdir) mkdir -p "$a" ;;
      personal-migrate)
        mv "$a" "$b"
        echo "Migrated $a → $b (personal instructions preserved there)"
        ;;
      personal-create)
        # The sidecar marks it as setup-owned so teardown.sh can safely remove
        # it without risking a user-owned empty file with the same name.
        touch "$a" "${a}.setup-managed"
        echo "Created empty $a (add machine-specific instructions there)"
        ;;
      include) INCLUDE_REFS+=("$a") ;;
      claude-md)
        apply_claude_md "$a" "$b"
        INCLUDE_REFS=()
        ;;
      link)
        ln -s "$a" "$b"
        echo "Linked $b -> $a"
        ;;
      relink)
        echo "Replacing stale symlink: $b -> $c"
        rm "$b"
        ln -s "$a" "$b"
        echo "Linked $b -> $a"
        ;;
      unlink)
        rm "$b"
        case "$a" in
          opted-out) echo "Removed opted-out symlink: $b -> $c" ;;
          superseded) echo "Removed superseded symlink: $b -> $c" ;;
          *)
            echo "Unknown unlink reason in plan: $a" >&2
            exit 20
            ;;
        esac
        ;;
      register-hook)
        ensure_hook_registered "$a" "${c:-}" "$b" "$HOME/.claude/settings.json"
        ;;
      deregister-hook)
        ensure_hook_deregistered "$a" "$b" "$HOME/.claude/settings.json"
        ;;
      *)
        echo "Unknown plan verb: $verb" >&2
        exit 20
        ;;
    esac
  done
}

# Decide first, from the state as it is now; then (unless --plan) apply.
PLAN="$(plan_install)"

if [[ "$DRY_RUN" == 1 ]]; then
  [[ -z "$PLAN" ]] || printf '%s\n' "$PLAN"
  exit 0
fi

apply_plan <<<"$PLAN"

# Last, so the linking work is already done and reported when these speak up.
# Advisory checks (git identity, pyte, companion plugins/tools, Aikido Safe
# Chain permission offer) are extracted into scripts/check-companions.sh.
# Skipped when --no-companions is passed (useful for tests that only exercise
# linking behavior and shouldn't depend on the companion-check shim setup).
# --install-deps and --fix both forward through unchanged; either one failing
# to apply what it was explicitly asked for is still a failure.
if [[ "$NO_COMPANIONS" != "1" ]]; then
  COMPANION_ARGS=()
  [[ "$INSTALL_DEPS" == "1" ]] && COMPANION_ARGS+=(--install-deps)
  [[ "$FIX" == "1" ]] && COMPANION_ARGS+=(--fix)
  "$REPO_ROOT/scripts/check-companions.sh" ${COMPANION_ARGS[@]+"${COMPANION_ARGS[@]}"}
fi

# Echo the selection flag back so the run is reproducible without the user
# having to remember it. Printed last so it isn't buried under the companion
# checks. Only the selection flag is repeated, not --install-deps/--fix.
if [[ -n "$SKIP_LIST" ]]; then
  printf '\nTo re-run with this feature selection:\n  ./setup.sh --skip=%s\n' "$SKIP_LIST"
elif [[ "$INCLUDE_SET" == 1 ]]; then
  printf '\nTo re-run with this feature selection:\n  ./setup.sh --include=%s\n' "$INCLUDE_LIST"
fi
