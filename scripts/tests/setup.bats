#!/usr/bin/env bats
# Unit tests for setup.sh — the symlink installer.
#
# This is the script with the most to lose from a regression: it writes into
# $HOME/.claude, a directory shared with every other plugin and with the user's
# own machine-local config. The behaviours worth pinning are the ones that
# decide whether it TOUCHES something it doesn't own.
#
# Each test copies the repo into the sandbox and runs setup.sh from there, so
# REPO_ROOT is a throwaway path and $HOME is redirected (see helpers.bash).
# Nothing here can reach the developer's real ~/.claude.

load helpers

# A fake python3, in its own directory rather than helpers.bash's shim-bin.
# setup.sh delegates to scripts/check-companions.sh, which runs the pyte
# probe; these shims suppress advisory output in the linking tests so
# unrelated assertions aren't buried in noise. The pyte-specific test cases
# live in check-companions.bats; the shim structure is copied there too.
#
# Usage: shim_python3 <yes|no>   (is pyte importable to begin with)
shim_python3() {
  PY_SHIM_BIN="$SANDBOX/py-shim"
  mkdir -p "$PY_SHIM_BIN"
  # Resolved once, before this function's own directory ever reaches PATH -
  # a second call within the same test must not re-resolve into the shim
  # it already installed. The fake binary below only fakes answers shaped
  # like the pyte probe; anything else (check_mattpocock_skills' JSON
  # parse) is handed to this real interpreter, so that logic gets exercised
  # for real rather than colliding with pyte-specific canned output.
  : "${REAL_PYTHON3:=$(command -v python3)}"
  export REAL_PYTHON3
  export FAKE_PY_EXE="/fake/bin/python3"
  export FAKE_PY_MARKER="$SANDBOX/pyte-installed"
  export FAKE_PIP_LOG="$SANDBOX/pip.log"
  export FAKE_PY_MANAGED="no"
  export FAKE_PY_VENV="no"
  export FAKE_PY_BROKEN="no"
  export FAKE_PIP_EXIT="0"
  export FAKE_PIP_INSTALLS="yes"
  if [ "$1" = "yes" ]; then
    : > "$FAKE_PY_MARKER"
  else
    rm -f "$FAKE_PY_MARKER"
  fi
  cat > "$PY_SHIM_BIN/python3" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
if [ "$FAKE_PY_BROKEN" = "yes" ]; then
  echo "fake python3: unusable interpreter" >&2
  exit 1
fi
case "${1:-}" in
  -c)
    case "${2:-}" in
      *EXTERNALLY-MANAGED*)
        echo "exe=$FAKE_PY_EXE"
        if [ -e "$FAKE_PY_MARKER" ]; then echo "pyte=yes"; else echo "pyte=no"; fi
        echo "managed=$FAKE_PY_MANAGED"
        echo "venv=$FAKE_PY_VENV"
        ;;
      *)
        exec "$REAL_PYTHON3" -c "$2"
        ;;
    esac
    ;;
  -m)
    shift
    printf '%s\n' "$*" >> "$FAKE_PIP_LOG"
    if [ "$FAKE_PIP_INSTALLS" = "yes" ] && [ "$FAKE_PIP_EXIT" = "0" ]; then
      : > "$FAKE_PY_MARKER"
    fi
    exit "$FAKE_PIP_EXIT"
    ;;
  *)
    echo "fake python3: unexpected args: $*" >&2
    exit 3
    ;;
esac
EOF
  chmod +x "$PY_SHIM_BIN/python3"
  case ":$PATH:" in
    *":$PY_SHIM_BIN:"*) ;;
    *) export PATH="$PY_SHIM_BIN:$PATH" ;;
  esac
}

# A fake `claude` CLI, so check_mattpocock_skills never depends on (or is
# blocked by) whatever the real binary would do inside the sandbox — it isn't
# one of _make_shims' network blockers, since `plugin list --json` is a local
# read, but stubbing it keeps the test independent of this machine's actual
# installed plugins.
#
# Usage: shim_claude <enabled|disabled|other-plugin-only|broken>
#
# No "missing" mode: that would need removing claude from PATH resolution
# entirely, but the sandbox only shims the network blockers in
# _make_shims — a developer machine's own `claude` binary (needed for
# real work outside these tests) stays reachable, so a shim can only ever
# shadow it earlier on PATH, not prove absence. "broken" below exercises the
# same "can't get useful data from it" code path this would have covered.
shim_claude() {
  CLAUDE_SHIM_BIN="$SANDBOX/claude-shim"
  mkdir -p "$CLAUDE_SHIM_BIN"
  # body is the full JSON array claude would print, per mode - not just one
  # object - so a mode can place a neighboring entry or reorder fields to
  # pin the parser against the grep-window bug found in review on #134.
  # Pretty-printed, one field per line, matching the real CLI's actual
  # `plugin list --json` output (confirmed on this machine) rather than a
  # compact single line - that shape is what let the old id-then-enabled
  # grep window get away with an "enabled" field ahead of "id" in a
  # single-object array: on one line, the id match already covers the whole
  # line regardless of field order, so a compact fixture wouldn't actually
  # have exercised the bug that ordering case is meant to catch.
  local mode="$1" body=""
  case "$mode" in
    enabled)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": true
  }
]'
      ;;
    disabled)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": false
  }
]'
      ;;
    other-plugin-only)
      body='[
  {
    "id": "dfadler-agent-config@skills-dir",
    "enabled": true
  }
]'
      ;;
    # Regression for the exact case review reproduced: a disabled target
    # sitting next to an unrelated ENABLED plugin. A window-based grep can
    # attribute the neighbor's "enabled": true to mattpocock-skills; a real
    # JSON parse can't, since it keys strictly by object.
    disabled-with-enabled-neighbor)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": false
  },
  {
    "id": "other-plugin@example",
    "enabled": true
  }
]'
      ;;
    # Field order within the object shouldn't matter to a real parser,
    # unlike a positional/window-based read.
    enabled-field-before-id)
      body='[
  {
    "enabled": true,
    "id": "mattpocock-skills@mattpocock"
  }
]'
      ;;
    broken) body="" ;;
    *)
      echo "shim_claude: unknown mode $mode" >&2
      return 1
      ;;
  esac
  if [ "$mode" = "broken" ]; then
    cat > "$CLAUDE_SHIM_BIN/claude" <<'EOF'
#!/usr/bin/env bash
echo "fake claude: broken" >&2
exit 1
EOF
  else
    cat > "$CLAUDE_SHIM_BIN/claude" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "plugin" ] && [ "\$2" = "list" ]; then
  echo '$body'
  exit 0
fi
echo "fake claude: unexpected args: \$*" >&2
exit 1
EOF
  fi
  chmod +x "$CLAUDE_SHIM_BIN/claude"
  case ":$PATH:" in
    *":$CLAUDE_SHIM_BIN:"*) ;;
    *) export PATH="$CLAUDE_SHIM_BIN:$PATH" ;;
  esac
}

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO"
  # Copy only what setup.sh reads, so the fixture stays small and stable.
  cp "$REPO_ROOT/setup.sh" "$FAKE_REPO/setup.sh"
  chmod +x "$FAKE_REPO/setup.sh"
  mkdir -p "$FAKE_REPO/claude/commands" "$FAKE_REPO/claude/conventions"
  echo "# global instructions" > "$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" > "$FAKE_REPO/claude/commands/demo.md"
  echo "## Convention one" > "$FAKE_REPO/claude/conventions/one.md"
  echo "## Convention two" > "$FAKE_REPO/claude/conventions/two.md"
  echo "## Convention three (opt-in only)" > "$FAKE_REPO/claude/conventions/three.md"
  printf '# comment, and a blank line below\n\none.md\ntwo.md\n' \
    > "$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  mkdir -p "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin"
  echo '{"name":"dfadler-agent-config"}' \
    > "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin/plugin.json"
  mkdir -p "$FAKE_REPO/scripts"
  cp "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" \
    "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  cp "$REPO_ROOT/scripts/git-identity.sh" "$FAKE_REPO/scripts/git-identity.sh"
  chmod +x "$FAKE_REPO/scripts/git-identity.sh"
  cp "$REPO_ROOT/scripts/check-companions.sh" \
    "$FAKE_REPO/scripts/check-companions.sh"
  chmod +x "$FAKE_REPO/scripts/check-companions.sh"
  # Default: an interpreter that already has pyte, so the link tests below
  # don't depend on whatever is installed on the machine running them.
  shim_python3 yes
  # Same reasoning for claude: default to already-installed-and-enabled so
  # unrelated tests aren't surprised by an advisory note they didn't ask for.
  shim_claude enabled
}

teardown() {
  destroy_sandbox
}

run_setup() {
  run bash "$FAKE_REPO/setup.sh"
}

run_setup_with() {
  run bash "$FAKE_REPO/setup.sh" "$@"
}

@test "creates the expected links from a clean HOME" {
  run_setup
  assert_success
  # CLAUDE.md is now a generated regular file, not a symlink.
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ -f "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
  [ "$(readlink "$HOME/.claude/skills/dfadler-agent-config")" = "$FAKE_REPO/plugins/dfadler-agent-config" ]
}

@test "links the plugin as a directory, not its contents" {
  run_setup
  assert_success
  [ -L "$HOME/.claude/skills/dfadler-agent-config" ]
  # If contents were linked individually there'd be per-skill entries here.
  local count
  count="$(find "$HOME/.claude/skills" -maxdepth 1 -mindepth 1 | wc -l | tr -d ' ')"
  [ "$count" -eq 1 ]
}

@test "is idempotent — a second run changes nothing and reports nothing new" {
  run_setup
  assert_success
  run_setup
  assert_success
  refute_output_contains "Linked"
  refute_output_contains "Replacing"
  refute_output_contains "Created"
  refute_output_contains "Updated"
  refute_output_contains "Prepended"
}

@test "generates one @include per DEFAULT_ENABLED entry, skipping comments/blanks" {
  run_setup
  assert_success
  grep -qF "@$FAKE_REPO/claude/conventions/one.md" "$HOME/.claude/CLAUDE.md"
  grep -qF "@$FAKE_REPO/claude/conventions/two.md" "$HOME/.claude/CLAUDE.md"
  # "three.md" isn't in DEFAULT_ENABLED — opt-in only, not generated by default.
  ! grep -qF "three.md" "$HOME/.claude/CLAUDE.md"
}

@test "a project with no claude/conventions/DEFAULT_ENABLED still generates the base two includes" {
  rm -rf "$FAKE_REPO/claude/conventions"
  run_setup
  assert_success
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  ! grep -qF "conventions/" "$HOME/.claude/CLAUDE.md"
}

@test "changing DEFAULT_ENABLED on re-run updates the managed section, preserving user additions" {
  run_setup
  assert_success
  printf '\nUser-added: some custom instruction\n' >> "$HOME/.claude/CLAUDE.md"
  printf 'one.md\ntwo.md\nthree.md\n' > "$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  run_setup
  assert_success
  assert_output_contains "Updated managed section"
  grep -qF "@$FAKE_REPO/claude/conventions/three.md" "$HOME/.claude/CLAUDE.md"
  grep -q "User-added: some custom instruction" "$HOME/.claude/CLAUDE.md"
}

@test "migrates a hand-maintained CLAUDE.md to CLAUDE.personal.md" {
  mkdir -p "$HOME/.claude"
  echo "hand-written config" > "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  assert_output_contains "Migrated"
  [ "$(cat "$HOME/.claude/CLAUDE.personal.md")" = "hand-written config" ]
  # CLAUDE.md is now the generated file, not a symlink.
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "when CLAUDE.personal.md exists, removes real CLAUDE.md to make room for generated file" {
  mkdir -p "$HOME/.claude"
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"
  echo "stale real file" > "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  refute_output_contains "Migrated"
  [ "$(cat "$HOME/.claude/CLAUDE.personal.md")" = "personal content" ]
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "creates empty CLAUDE.personal.md when no CLAUDE.md exists" {
  run_setup
  assert_success
  [ -f "$HOME/.claude/CLAUDE.personal.md" ]
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "writes a setup-managed marker alongside the empty CLAUDE.personal.md placeholder" {
  run_setup
  assert_success
  [ -f "$HOME/.claude/CLAUDE.personal.md.setup-managed" ]
}

@test "does not write a setup-managed marker when migrating an existing CLAUDE.md" {
  mkdir -p "$HOME/.claude"
  echo "hand-written config" > "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  [ ! -e "$HOME/.claude/CLAUDE.personal.md.setup-managed" ]
}

# ~/.claude/skills is shared with every other skills-dir plugin. A live symlink
# pointing somewhere else belongs to another tool and must survive.
@test "leaves another plugin's live symlink alone" {
  mkdir -p "$HOME/.claude/skills" "$SANDBOX/other-plugin"
  ln -s "$SANDBOX/other-plugin" "$HOME/.claude/skills/someone-elses"
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/skills/someone-elses")" = "$SANDBOX/other-plugin" ]
}

@test "replaces a legacy symlink to this repo with a generated file" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  assert_output_contains "Replaced repo symlink"
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "replaces a stale symlink into this repo with a generated file" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/OLD-NAME.md" "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  # The stale link is within the repo — link() replaces it; ensure_claude_md_includes sees a symlink.
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

@test "prepends managed section to an existing user-owned CLAUDE.md" {
  mkdir -p "$HOME/.claude"
  echo "my own config" > "$HOME/.claude/CLAUDE.md"
  # Prevent migrate_personal_claude_md from consuming it.
  touch "$HOME/.claude/CLAUDE.personal.md"
  run_setup
  assert_success
  assert_output_contains "Prepended managed section"
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  grep -q "my own config" "$HOME/.claude/CLAUDE.md"
}

@test "updating repo path on re-run preserves user additions below the managed section" {
  mkdir -p "$HOME/.claude"
  touch "$HOME/.claude/CLAUDE.personal.md"
  run_setup
  assert_success
  # Simulate a user addition written by some external tool.
  printf '\nUser-added: some custom instruction\n' >> "$HOME/.claude/CLAUDE.md"
  # Re-run: managed section updated, user addition preserved.
  run_setup
  assert_success
  grep -q "User-added: some custom instruction" "$HOME/.claude/CLAUDE.md"
  grep -qF "@$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
}

# Two generations of superseded links exist: per-skill entries from before the
# plugin was linked as a unit, and links under the old generic-tools name.
@test "prunes a superseded per-skill link into this repo's plugins/" {
  mkdir -p "$HOME/.claude/skills"
  ln -s "$FAKE_REPO/plugins/dfadler-agent-config/skills/gh-attach-image" \
    "$HOME/.claude/skills/gh-attach-image"
  run_setup
  assert_success
  assert_output_contains "Removed superseded symlink"
  [ ! -e "$HOME/.claude/skills/gh-attach-image" ] && [ ! -L "$HOME/.claude/skills/gh-attach-image" ]
}

@test "prunes a superseded link under the old plugin name" {
  mkdir -p "$HOME/.claude/agents"
  ln -s "$FAKE_REPO/plugins/generic-tools/agents/adversarial-reviewer.md" \
    "$HOME/.claude/agents/adversarial-reviewer.md"
  run_setup
  assert_success
  [ ! -L "$HOME/.claude/agents/adversarial-reviewer.md" ]
}

# c0568ad: readlink reports the target as stored, so a RELATIVE link into
# plugins/ has to be resolved before the ownership comparison — otherwise it
# reads as foreign and survives the prune.
@test "prunes a superseded link stored as a relative target" {
  mkdir -p "$HOME/.claude/skills"
  # $HOME is $SANDBOX/home and the repo is $SANDBOX/repo, so this is the real
  # relative path from the link's directory into the repo's plugins/.
  # resolve_target cds into the target's PARENT, so that directory has to exist.
  mkdir -p "$FAKE_REPO/plugins/dfadler-agent-config/skills"
  ln -s "../../../repo/plugins/dfadler-agent-config/skills/old-skill" \
    "$HOME/.claude/skills/old-skill"
  # Sanity-check the fixture itself: if this relative target didn't actually
  # point into the repo, the test would pass for the wrong reason.
  [ "$(cd "$HOME/.claude/skills" && cd "$(dirname "$(readlink old-skill)")" && pwd)" \
    = "$FAKE_REPO/plugins/dfadler-agent-config/skills" ]

  run_setup
  assert_success
  [ ! -L "$HOME/.claude/skills/old-skill" ]
}

@test "keeps the current plugin link across repeated runs" {
  run_setup
  assert_success
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/skills/dfadler-agent-config")" = "$FAKE_REPO/plugins/dfadler-agent-config" ]
}

@test "does not prune a foreign link that merely lives in skills/" {
  mkdir -p "$HOME/.claude/skills" "$SANDBOX/elsewhere"
  ln -s "$SANDBOX/elsewhere" "$HOME/.claude/skills/unrelated"
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/skills/unrelated")" = "$SANDBOX/elsewhere" ]
}

@test "--help prints usage and links nothing" {
  run_setup_with --help
  assert_success
  assert_output_contains "--install-deps"
  [ ! -e "$HOME/.claude" ]
}

@test "an unknown argument exits 2 and links nothing" {
  run_setup_with --nope
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown argument: --nope"
  [ ! -e "$HOME/.claude" ]
}
