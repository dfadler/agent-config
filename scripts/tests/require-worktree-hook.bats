#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# require-worktree-hook.sh — the PreToolUse hook that blocks Edit/Write in
# the main git checkout and allows them in a linked worktree.
#
# Hermetic: the REAL hook script is copied into a throwaway directory
# alongside a fake `git` shim that returns controllable git-dir output.
# The shim is placed at the front of PATH so the hook sees it instead of
# the real git — nothing touches a real git repo, worktree, or filesystem.

REAL_HOOK="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/require-worktree-hook.sh"

setup() {
  TMP="$(mktemp -d)"
  cp "$REAL_HOOK" "$TMP/require-worktree-hook.sh"
  SCRIPT_UNDER_TEST="$TMP/require-worktree-hook.sh"

  GIT_SHIM="$TMP/shim-bin"
  mkdir -p "$GIT_SHIM"
  export GIT_SHIM

  # Default: real git command is unavailable (not-a-git-repo case).
  _install_fake_git ""
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

# Install a fake git that returns FAKE_GIT_DIR for `git rev-parse --git-dir`.
# Pass an empty string to simulate not being inside a git repo (exit 128).
_install_fake_git() {
  local fake_dir="$1"
  export FAKE_GIT_DIR="$fake_dir"
  cat >"$GIT_SHIM/git" <<'EOF'
#!/usr/bin/env bash
if [ "${1:-}" = "rev-parse" ] && [ "${2:-}" = "--git-dir" ]; then
  if [ -z "${FAKE_GIT_DIR:-}" ]; then
    echo "fatal: not a git repository" >&2
    exit 128
  fi
  printf '%s\n' "$FAKE_GIT_DIR"
  exit 0
fi
exec git "$@"
EOF
  chmod +x "$GIT_SHIM/git"
}

run_hook() {
  run env -u WORKTREE_ENFORCE -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
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
# Main checkout: hook blocks.
# ---------------------------------------------------------------------------

@test "main checkout (.git): exits 1 with helpful message" {
  _install_fake_git ".git"
  run_hook
  [ "$status" -eq 1 ]
  [[ "$output" == *"main git checkout"* ]]
  [[ "$output" == *"EnterWorktree"* ]]
}

@test "main checkout (absolute path ending .git): exits 1" {
  _install_fake_git "/home/user/project/.git"
  run_hook
  [ "$status" -eq 1 ]
  [[ "$output" == *"main git checkout"* ]]
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
# Escape hatch: WORKTREE_ENFORCE=0 (and variants) bypasses the check.
# ---------------------------------------------------------------------------

@test "WORKTREE_ENFORCE=0: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    WORKTREE_ENFORCE=0 \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=false: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    WORKTREE_ENFORCE=false \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=no: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    WORKTREE_ENFORCE=no \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=off: exits 0 even in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    WORKTREE_ENFORCE=off \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 0 ]
}

@test "WORKTREE_ENFORCE=1 (anything else): still blocks in main checkout" {
  _install_fake_git ".git"
  run env -u CLAUDE_CODE_REMOTE \
    PATH="$GIT_SHIM:$PATH" \
    WORKTREE_ENFORCE=1 \
    /bin/bash "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 1 ]
}
