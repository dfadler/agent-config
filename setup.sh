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

# --------------------------------------------------------------------------
# Runtime dependencies
#
# The detached-terminal skill's agent_term.py is `#!/usr/bin/env python3`, so
# it runs under whatever python3 is FIRST ON PATH when an agent invokes it.
# Nothing activates this repo's .venv (the one `make venv` builds for CI) on
# the skill's behalf, so a green `make check` says nothing about whether the
# skill can actually start. pyte has to be importable by the ambient
# interpreter, and setup time is the only moment that gap can surface before
# an agent hits it mid-task.
#
# One probe answers every question at once, so the interpreter is consulted
# once and the answers can't disagree with each other:
#   exe=      the interpreter that would really run the skill
#   pyte=     is the dependency importable by it
#   managed=  PEP 668 externally-managed (a plain pip install would be refused)
#   venv=     already inside a virtualenv (where `pip --user` is an error)
# --------------------------------------------------------------------------
PYTE_PROBE='import os, sys, sysconfig
try:
    import pyte  # noqa: F401
    found = "yes"
except ImportError:
    found = "no"
marker = os.path.join(sysconfig.get_path("stdlib"), "EXTERNALLY-MANAGED")
print("exe=" + sys.executable)
print("pyte=" + found)
print("managed=" + ("yes" if os.path.exists(marker) else "no"))
print("venv=" + ("yes" if sys.prefix != sys.base_prefix else "no"))
'

# Read one field out of a probe result. Empty for a field the probe never
# printed, which is also what a failed probe yields.
probe_field() {
  printf '%s\n' "$1" | sed -n "s/^$2=//p" | head -n1
}

run_probe() {
  python3 -c "$PYTE_PROBE" 2>/dev/null || true
}

report_missing_pyte() {
  local exe="$1" managed="$2"
  {
    echo
    echo "⚠ pyte is NOT installed for $exe"
    echo "  The detached-terminal skill will fail the first time an agent uses it."
    echo "  That skill runs under whatever python3 is first on PATH, so this repo's"
    echo "  .venv (make venv) does not satisfy it."
    echo
    if [[ "$managed" == "yes" ]]; then
      echo "  That interpreter is PEP 668 externally-managed, so pip will refuse to"
      echo "  install into it. Pick one:"
      echo "    - the OS package, e.g.  sudo apt install python3-pyte"
      echo "    - python3 -m pip install --user --break-system-packages pyte"
      echo "    - put an interpreter you own first on PATH, with pyte installed in it"
    else
      echo "  Install it with:"
      echo "    python3 -m pip install --user pyte"
      echo "  or re-run this script as:"
      echo "    ./setup.sh --install-deps"
    fi
    echo
  } >&2
}

install_pyte() {
  local exe="$1" managed="$2" venv="$3"
  # pip against an externally-managed interpreter fails with a wall of text
  # about PEP 668; say the useful thing instead of letting pip say the
  # confusing one.
  if [[ "$managed" == "yes" ]]; then
    report_missing_pyte "$exe" "$managed"
    echo "Not running pip: $exe is externally managed (see the options above)." >&2
    return 1
  fi

  # --user is an error inside a virtualenv ("User site-packages are not
  # visible in this virtualenv"), where the venv itself is already the
  # per-user location.
  local -a cmd=(python3 -m pip install)
  if [[ "$venv" == "no" ]]; then
    cmd+=(--user)
  fi
  cmd+=(pyte)

  echo "Installing pyte: ${cmd[*]}"
  if ! "${cmd[@]}"; then
    echo "pip install failed." >&2
    report_missing_pyte "$exe" "$managed"
    return 1
  fi

  # Trust the import, not pip's exit status: pip can succeed into a site
  # directory this interpreter doesn't actually search.
  if [[ "$(probe_field "$(run_probe)" pyte)" != "yes" ]]; then
    echo "pip reported success, but pyte still isn't importable by $exe." >&2
    report_missing_pyte "$exe" "$managed"
    return 1
  fi
  echo "✓ pyte installed and importable by $exe"
}

check_git_identity() {
  if "$REPO_ROOT/scripts/git-identity.sh" >/dev/null 2>&1; then
    echo "✓ git identity is configured (scripts/git-identity.sh)"
  else
    {
      echo
      echo "⚠ git identity (user.name/user.email) is not fully configured."
      echo "  Tooling that relies on scripts/git-identity.sh (e.g. an automated"
      echo "  commit) will fail loudly until this is set. Configure it with:"
      echo "    git config --global user.name \"Your Name\""
      echo "    git config --global user.email you@example.com"
      echo
    } >&2
  fi
}

check_python_deps() {
  local probe have exe managed venv
  probe="$(run_probe)"
  have="$(probe_field "$probe" pyte)"

  if [[ -z "$have" ]]; then
    {
      echo
      echo "⚠ Could not run python3, so the detached-terminal skill's pyte"
      echo "  dependency could not be checked. That skill needs Python 3.10+ with"
      echo "  pyte importable by the python3 first on PATH."
      echo
    } >&2
    return 0
  fi

  exe="$(probe_field "$probe" exe)"
  managed="$(probe_field "$probe" managed)"
  venv="$(probe_field "$probe" venv)"

  if [[ "$have" == "yes" ]]; then
    echo "✓ pyte is importable by $exe — the detached-terminal skill is ready"
    return 0
  fi

  if [[ "$INSTALL_DEPS" == "1" ]]; then
    install_pyte "$exe" "$managed" "$venv"
    return
  fi

  report_missing_pyte "$exe" "$managed"
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

# Last, so the linking work is already done and reported when these speak up.
# Both are warnings, not failures: the symlinks are correct either way, and
# `./setup.sh && something-else` shouldn't break over either one. An
# explicitly requested --install-deps that doesn't install is still a failure.
check_git_identity
check_python_deps
