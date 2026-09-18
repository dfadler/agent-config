#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# require-worktree-hook.sh — the PreToolUse hook that blocks/warns/allows
# Edit/Write in the main git checkout based on configured enforce mode.
#
# Hermetic: the REAL hook script is copied into a throwaway directory alongside
# a fake `git` shim that returns controllable output for both --git-dir and
# --show-toplevel. The shim is placed at the front of PATH; nothing touches a
# real git repo, worktree, or filesystem.

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/require-worktree-hook.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/require-worktree-hook.sh"
  SCRIPT_UNDER_TEST="$TMP/require-worktree-hook.sh"

  GIT_SHIM="$TMP/shim-bin"
  FAKE_TOPLEVEL="$TMP/toplevel"
  mkdir -p "$GIT_SHIM" "$FAKE_TOPLEVEL/.claude"
  export GIT_SHIM FAKE_TOPLEVEL

  # Default: not inside a git repo.
  _install_fake_git "" "$FAKE_TOPLEVEL"
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

# Install a fake git that returns FAKE_GIT_DIR for `git rev-parse --git-dir`
# and FAKE_GIT_TOPLEVEL for `git rev-parse --show-toplevel`.
# Pass an empty FAKE_GIT_DIR to simulate not being inside a git repo (exit 128).
_install_fake_git() {
  local fake_dir="$1"
  local fake_toplevel="${2:-$FAKE_TOPLEVEL}"
  export FAKE_GIT_DIR="$fake_dir" FAKE_GIT_TOPLEVEL="$fake_toplevel"
  cat >"$GIT_SHIM/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "rev-parse" ]; then
  if [ "${2:-}" = "--git-dir" ]; then
    if [ -z "${FAKE_GIT_DIR:-}" ]; then
      echo "fatal: not a git repository" >&2
      exit 128
    fi
    printf '%s\n' "$FAKE_GIT_DIR"
    exit 0
  fi
  if [ "${2:-}" = "--show-toplevel" ]; then
    printf '%s\n' "${FAKE_GIT_TOPLEVEL:-}"
    exit 0
  fi
fi
exec git "$@"
EOF
  chmod +x "$GIT_SHIM/git"
}

_write_settings_enforce() {
  printf '{"worktree":{"enforce":"%s"}}\n' "$1" >"$FAKE_TOPLEVEL/.claude/settings.json"
}

run_hook() {
  run env -u WORKTREE_ENFORCE -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    FAKE_GIT_DIR="${FAKE_GIT_DIR:-}" \
    FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    "$@" /bin/bash "$SCRIPT_UNDER_TEST"
}

# ---------------------------------------------------------------------------
# Remote / cloud sessions are always allowed.
# ---------------------------------------------------------------------------

@test "remote: exits 0 immediately without calling git" {
  run env CLAUDE_CODE_REMOTE=true \
    PATH="$GIT_SHIM:$PATH" \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Non-git directory: hook is a no-op.
# ---------------------------------------------------------------------------

@test "non-git dir: exits 0, no output" {
  _install_fake_git ""
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

# ---------------------------------------------------------------------------
# Main checkout: off by default — a project must opt in before this blocks.
# ---------------------------------------------------------------------------

@test "main checkout (.git), nothing configured: exits 0, no output" {
  _install_fake_git ".git"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "main checkout (absolute path ending .git), nothing configured: exits 0" {
  _install_fake_git "/home/user/project/.git"
  run_hook
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Linked worktree: hook allows.
# ---------------------------------------------------------------------------

@test "linked worktree: exits 0, no output" {
  _install_fake_git "/home/user/project/.git/worktrees/my-feature"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "nested linked worktree path: exits 0" {
  _install_fake_git "/deep/repo/path/.git/worktrees/task-branch"
  run_hook
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# WORKTREE_ENFORCE env var: session-level override (highest priority).
# ---------------------------------------------------------------------------

@test "WORKTREE_ENFORCE=0: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=0 /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=false: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=false /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=no: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=no /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=off: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=off /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=warn: exits 0 with warning, does not block" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=warn /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
  [[ "$output" == *"Warning"* ]] || [[ "$output" == *"warning"* ]]
}

@test "WORKTREE_ENFORCE=warn overrides settings enforce=block" {
  _install_fake_git ".git"
  _write_settings_enforce "block"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=warn /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=block: forces block for this session, overriding no config" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=block /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 1 ]
  [[ "$output" == *"main git checkout"* ]]
}

@test "WORKTREE_ENFORCE=1 (anything else, not a recognized value): falls through to settings/default (off)" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" FAKE_GIT_TOPLEVEL="$FAKE_TOPLEVEL" \
    WORKTREE_ENFORCE=1 /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# worktree.enforce in settings.json: project-level config (opt-in).
# ---------------------------------------------------------------------------

@test "settings enforce=block: exits 1 (explicit opt-in)" {
  _install_fake_git ".git"
  _write_settings_enforce "block"
  run_hook
  [ "$status" -eq 1 ]
  [[ "$output" == *"main git checkout"* ]]
}

@test "settings enforce=warn: exits 0 with warning" {
  _install_fake_git ".git"
  _write_settings_enforce "warn"
  run_hook
  [ "$status" -eq 0 ]
  [[ "$output" == *"Warning"* ]] || [[ "$output" == *"warning"* ]]
}

@test "settings enforce=off: exits 0, no output" {
  _install_fake_git ".git"
  _write_settings_enforce "off"
  run_hook
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "settings unknown enforce value: falls back to off" {
  _install_fake_git ".git"
  _write_settings_enforce "maybe"
  run_hook
  [ "$status" -eq 0 ]
}

@test "no settings.json: defaults to off" {
  _install_fake_git ".git"
  # No settings.json written — FAKE_TOPLEVEL/.claude/ exists but is empty.
  run_hook
  [ "$status" -eq 0 ]
}

@test "jq fails: falls back to off even if settings says block" {
  _install_fake_git ".git"
  _write_settings_enforce "block"
  # Put a broken jq in GIT_SHIM (first on PATH) that always exits 1.
  # Simulates jq failing to parse; the hook should fall back to "off".
  printf '#!/usr/bin/env bash\nexit 1\n' >"$GIT_SHIM/jq"
  chmod +x "$GIT_SHIM/jq"
  run_hook
  [ "$status" -eq 0 ]
}
