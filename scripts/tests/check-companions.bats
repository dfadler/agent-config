#!/usr/bin/env bats
# Unit tests for scripts/check-companions.sh — the advisory companion checks
# that setup.sh delegates to after the core symlinking is done.
#
# Each test runs against a copy of check-companions.sh inside a sandbox so
# REPO_ROOT is a throwaway path and $HOME is redirected (see helpers.bash).
# Nothing here can reach the developer's real ~/.claude.

load helpers

# A fake python3, in its own directory rather than helpers.bash's shim-bin, so
# a test can drop back to the REAL interpreter (see the probe contract test at
# the bottom) without also losing the network blockers.
#
# It answers check-companions.sh's probe from env vars and records what
# `-m pip install` was asked to do. `pip install` also creates the marker file
# the probe reads, so "pip ran" and "pyte is importable" are separate facts the
# way they are on a real machine — which is what lets a test pin the
# difference.
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

unshim_python3() {
  rm -f "$PY_SHIM_BIN/python3"
}

# A fake `claude` CLI, so check_mattpocock_skills never depends on (or is
# blocked by) whatever the real binary would do inside the sandbox.
#
# Usage: shim_claude <enabled|disabled|other-plugin-only|broken>
shim_claude() {
  CLAUDE_SHIM_BIN="$SANDBOX/claude-shim"
  mkdir -p "$CLAUDE_SHIM_BIN"
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
  mkdir -p "$FAKE_REPO/scripts"
  # Copy only what check-companions.sh reads, so the fixture stays small and
  # stable.
  cp "$REPO_ROOT/scripts/check-companions.sh" \
    "$FAKE_REPO/scripts/check-companions.sh"
  chmod +x "$FAKE_REPO/scripts/check-companions.sh"
  cp "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" \
    "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  cp "$REPO_ROOT/scripts/git-identity.sh" "$FAKE_REPO/scripts/git-identity.sh"
  chmod +x "$FAKE_REPO/scripts/git-identity.sh"
  # Default: an interpreter that already has pyte, so unrelated tests don't
  # depend on whatever is installed on the machine running them.
  shim_python3 yes
  # Same reasoning for claude: default to already-installed-and-enabled so
  # unrelated tests aren't surprised by an advisory note they didn't ask for.
  shim_claude enabled
}

teardown() {
  destroy_sandbox
}

run_companions() {
  run bash "$FAKE_REPO/scripts/check-companions.sh" "$@"
}

# --- git identity check -----------------------------------------------------
#
# scripts/git-identity.sh is the actual check (see its own bats suite); these
# tests just pin that check-companions.sh calls it and treats the result as a
# warning, not a failure. HOME is sandboxed by make_sandbox, so there's no
# global gitconfig here unless a test sets one.

@test "warns when git identity is not configured" {
  run_companions
  assert_success
  assert_output_contains "git identity (user.name/user.email) is not fully configured"
  assert_output_contains "git config --global user.name"
}

@test "confirms git identity when configured" {
  git config --global user.name "Dev Name"
  git config --global user.email "dev@example.com"
  run_companions
  assert_success
  assert_output_contains "git identity is configured"
  refute_output_contains "not fully configured"
}

# The check must reflect REPO_ROOT's git config, not whatever directory
# check-companions.sh happens to be invoked from — REPO_ROOT is derived from
# ${BASH_SOURCE[0]}, not from $PWD.
@test "git identity check reflects REPO_ROOT, not the caller's cwd" {
  git -C "$FAKE_REPO" init -q
  git -C "$FAKE_REPO" config user.name "Repo Name"
  git -C "$FAKE_REPO" config user.email "repo@example.com"

  mkdir -p "$SANDBOX/elsewhere"
  git -C "$SANDBOX/elsewhere" init -q
  # No identity here, and no global config either (HOME is sandboxed) — if
  # the check ran relative to this directory it would report unconfigured.

  run bash -c 'cd "$1" && bash "$2/scripts/check-companions.sh"' \
    -- "$SANDBOX/elsewhere" "$FAKE_REPO"
  assert_success
  assert_output_contains "git identity is configured"
  refute_output_contains "not fully configured"
}

# --- runtime dependency check (#88) ----------------------------------------
#
# detached-terminal's agent_term.py runs under whatever python3 is first on
# PATH, so check-companions.sh checks THAT interpreter. The fake python3
# above stands in for it; the last test in this file checks the probe against
# the real one.

@test "reports a missing pyte against the interpreter that would run the skill" {
  shim_python3 no
  run_companions
  # A missing dependency is a warning, so the script still exits 0.
  assert_success
  assert_output_contains "pyte is NOT installed for /fake/bin/python3"
  assert_output_contains "python3 -m pip install --user pyte"
  assert_output_contains "./setup.sh --install-deps"
}

@test "verifying never installs anything on its own" {
  shim_python3 no
  run_companions
  assert_success
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "confirms a pyte that is already importable" {
  shim_python3 yes
  run_companions
  assert_success
  assert_output_contains "pyte is importable by /fake/bin/python3"
  refute_output_contains "NOT installed"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps installs into the user site" {
  shim_python3 no
  run_companions --install-deps
  assert_success
  assert_output_contains "pyte installed and importable"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

# --user is an error inside a virtualenv, so the flag has to come off there.
@test "--install-deps drops --user inside a virtualenv" {
  shim_python3 no
  export FAKE_PY_VENV=yes
  run_companions --install-deps
  assert_success
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install pyte" ]
}

# PEP 668: pip would refuse with a wall of text. Say the useful thing instead.
@test "--install-deps explains rather than running a doomed pip when externally managed" {
  shim_python3 no
  export FAKE_PY_MANAGED=yes
  run_companions --install-deps
  assert_failure
  assert_output_contains "externally managed"
  assert_output_contains "break-system-packages"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps fails loudly when pip fails" {
  shim_python3 no
  export FAKE_PIP_EXIT=1
  run_companions --install-deps
  assert_failure
  assert_output_contains "pip install failed"
  assert_output_contains "python3 -m pip install --user pyte"
}

# pip can exit 0 having installed somewhere this interpreter doesn't search.
# The import is the fact that matters, so it is re-checked afterwards.
@test "--install-deps trusts the import, not pip's exit status" {
  shim_python3 no
  export FAKE_PIP_INSTALLS=no
  run_companions --install-deps
  assert_failure
  assert_output_contains "pip reported success"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

@test "an unusable python3 is reported without failing" {
  shim_python3 no
  export FAKE_PY_BROKEN=yes
  run_companions
  assert_success
  assert_output_contains "Could not run python3"
}

# --- companion plugin check (#134) ------------------------------------------
#
# Purely advisory — nothing here depends on mattpocock-skills, unlike pyte,
# so every case below asserts the script still exits 0 and there's no
# --install-deps equivalent to test.

@test "confirms mattpocock-skills when installed and enabled" {
  shim_claude enabled
  run_companions
  assert_success
  assert_output_contains "✓ mattpocock-skills is installed"
}

@test "warns when mattpocock-skills is installed but disabled" {
  shim_claude disabled
  run_companions
  assert_success
  assert_output_contains "installed but disabled"
  assert_output_contains "claude plugin enable mattpocock-skills"
}

# Regression (review on #134): the original implementation grepped a fixed
# line window after the id line for "enabled": true, which could pick up a
# NEIGHBORING plugin's field instead of the matched one's.
@test "a disabled target isn't misread as enabled via a neighboring plugin" {
  shim_claude disabled-with-enabled-neighbor
  run_companions
  assert_success
  assert_output_contains "installed but disabled"
  refute_output_contains "✓ mattpocock-skills is installed"
}

# Regression (review on #134): field order within the JSON object shouldn't
# matter to a real parser, unlike a positional/window-based read.
@test "field order within the plugin object doesn't confuse detection" {
  shim_claude enabled-field-before-id
  run_companions
  assert_success
  assert_output_contains "✓ mattpocock-skills is installed"
}

@test "notes when mattpocock-skills is not installed" {
  shim_claude other-plugin-only
  run_companions
  assert_success
  assert_output_contains "mattpocock-skills is not installed"
  assert_output_contains "claude plugin install mattpocock-skills"
}

@test "stays silent about mattpocock-skills when the claude CLI errors" {
  shim_claude broken
  run_companions
  assert_success
  refute_output_contains "mattpocock-skills"
}

# --- Aikido Safe Chain permission offer (advisory) --------------------------
#
# offer-safe-chain-permission.sh has its own bats suite; these tests just pin
# that check-companions.sh calls it as the final step and treats its failure
# as advisory via `|| true` rather than letting it end the run — that script
# can genuinely return nonzero (missing jq, a corrupt settings.json).

@test "runs the Aikido Safe Chain offer as the final step" {
  run_companions
  assert_success
  assert_output_contains "Skipping Aikido Safe Chain permission prompt"
}

@test "a failing Aikido Safe Chain offer does not fail check-companions.sh" {
  cat > "$FAKE_REPO/scripts/offer-safe-chain-permission.sh" <<'EOF'
#!/usr/bin/env bash
echo "stub offer script: simulated failure" >&2
exit 1
EOF
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  run_companions
  assert_success
  assert_output_contains "stub offer script: simulated failure"
}

# --- argument parsing -------------------------------------------------------

@test "--help prints usage and runs no checks" {
  run_companions --help
  assert_success
  assert_output_contains "--install-deps"
  refute_output_contains "git identity"
  refute_output_contains "pyte is NOT"
}

@test "an unknown argument exits 2" {
  run_companions --nope
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown argument: --nope"
}

# --- probe contract test ----------------------------------------------------
#
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
  run_companions
  assert_success
  assert_output_contains "$expected"
}
