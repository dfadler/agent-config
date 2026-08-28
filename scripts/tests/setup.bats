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

# A fake python3, in its own directory rather than helpers.bash's shim-bin, so
# a test can drop back to the REAL interpreter (see the probe contract test at
# the bottom) without also losing the network blockers.
#
# It answers setup.sh's probe from env vars and records what `-m pip install`
# was asked to do. `pip install` also creates the marker file the probe reads,
# so "pip ran" and "pyte is importable" are separate facts the way they are on
# a real machine — which is what lets a test pin the difference.
#
# Usage: shim_python3 <yes|no>   (is pyte importable to begin with)
shim_python3() {
  PY_SHIM_BIN="$SANDBOX/py-shim"
  mkdir -p "$PY_SHIM_BIN"
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
    echo "exe=$FAKE_PY_EXE"
    if [ -e "$FAKE_PY_MARKER" ]; then echo "pyte=yes"; else echo "pyte=no"; fi
    echo "managed=$FAKE_PY_MANAGED"
    echo "venv=$FAKE_PY_VENV"
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

unshim_python3() {
  rm -f "$PY_SHIM_BIN/python3"
}

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO"
  # Copy only what setup.sh reads, so the fixture stays small and stable.
  cp "$REPO_ROOT/setup.sh" "$FAKE_REPO/setup.sh"
  chmod +x "$FAKE_REPO/setup.sh"
  mkdir -p "$FAKE_REPO/claude/commands"
  echo "# global instructions" > "$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" > "$FAKE_REPO/claude/commands/demo.md"
  mkdir -p "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin"
  echo '{"name":"dfadler-agent-config"}' \
    > "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin/plugin.json"
  # Default: an interpreter that already has pyte, so the link tests below
  # don't depend on whatever is installed on the machine running them.
  shim_python3 yes
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
  [ "$(readlink "$HOME/.claude/CLAUDE.md")" = "$FAKE_REPO/claude/CLAUDE.md" ]
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
}

@test "leaves a foreign file at the target alone" {
  mkdir -p "$HOME/.claude"
  echo "hand-written config" > "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  assert_output_contains "already exists and isn't a symlink"
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "hand-written config" ]
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

@test "replaces a stale symlink that points into this repo" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/OLD-NAME.md" "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  assert_output_contains "Replacing stale symlink"
  [ "$(readlink "$HOME/.claude/CLAUDE.md")" = "$FAKE_REPO/claude/CLAUDE.md" ]
}

@test "takes over a broken symlink pointing outside the repo" {
  mkdir -p "$HOME/.claude"
  ln -s "$SANDBOX/nowhere/gone.md" "$HOME/.claude/CLAUDE.md"
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/CLAUDE.md")" = "$FAKE_REPO/claude/CLAUDE.md" ]
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

# --- runtime dependency check (#88) ----------------------------------------
#
# detached-terminal's agent_term.py runs under whatever python3 is first on
# PATH, so setup.sh checks THAT interpreter. The fake python3 above stands in
# for it; the last test in this file checks the probe against the real one.

@test "reports a missing pyte against the interpreter that would run the skill" {
  shim_python3 no
  run_setup
  # Linking is the script's job and it succeeded; a missing dependency is a
  # warning, so `./setup.sh && ...` doesn't break over it.
  assert_success
  assert_output_contains "pyte is NOT installed for /fake/bin/python3"
  assert_output_contains "python3 -m pip install --user pyte"
  assert_output_contains "./setup.sh --install-deps"
  [ "$(readlink "$HOME/.claude/CLAUDE.md")" = "$FAKE_REPO/claude/CLAUDE.md" ]
}

@test "verifying never installs anything on its own" {
  shim_python3 no
  run_setup
  assert_success
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "confirms a pyte that is already importable" {
  shim_python3 yes
  run_setup
  assert_success
  assert_output_contains "pyte is importable by /fake/bin/python3"
  refute_output_contains "NOT installed"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps installs into the user site" {
  shim_python3 no
  run_setup_with --install-deps
  assert_success
  assert_output_contains "pyte installed and importable"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

# --user is an error inside a virtualenv, so the flag has to come off there.
@test "--install-deps drops --user inside a virtualenv" {
  shim_python3 no
  export FAKE_PY_VENV=yes
  run_setup_with --install-deps
  assert_success
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install pyte" ]
}

# PEP 668: pip would refuse with a wall of text. Say the useful thing instead.
@test "--install-deps explains rather than running a doomed pip when externally managed" {
  shim_python3 no
  export FAKE_PY_MANAGED=yes
  run_setup_with --install-deps
  assert_failure
  assert_output_contains "externally managed"
  assert_output_contains "break-system-packages"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps fails loudly when pip fails" {
  shim_python3 no
  export FAKE_PIP_EXIT=1
  run_setup_with --install-deps
  assert_failure
  assert_output_contains "pip install failed"
  assert_output_contains "python3 -m pip install --user pyte"
}

# pip can exit 0 having installed somewhere this interpreter doesn't search.
# The import is the fact that matters, so it is re-checked afterwards.
@test "--install-deps trusts the import, not pip's exit status" {
  shim_python3 no
  export FAKE_PIP_INSTALLS=no
  run_setup_with --install-deps
  assert_failure
  assert_output_contains "pip reported success"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

@test "an unusable python3 is reported without failing the linking" {
  shim_python3 no
  export FAKE_PY_BROKEN=yes
  run_setup
  assert_success
  assert_output_contains "Could not run python3"
  [ "$(readlink "$HOME/.claude/CLAUDE.md")" = "$FAKE_REPO/claude/CLAUDE.md" ]
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

# The fake python3 answers the probe by fiat, so none of the tests above can
# catch a probe SCRIPT that doesn't work (wrong field names, an exception, a
# Python version that lacks something it uses). This one runs the real
# interpreter and pins the probe's answer to independently observed truth.
# Still hermetic: reading the local interpreter touches no network.
@test "the probe reports the real python3 correctly" {
  unshim_python3
  command -v python3 > /dev/null 2>&1 || skip "no python3 on PATH"
  local exe expected
  exe="$(python3 -c 'import sys; print(sys.executable)')"
  if python3 -c 'import pyte' 2>/dev/null; then
    expected="pyte is importable by $exe"
  else
    expected="pyte is NOT installed for $exe"
  fi
  run_setup
  assert_success
  assert_output_contains "$expected"
}
