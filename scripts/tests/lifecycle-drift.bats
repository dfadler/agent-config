#!/usr/bin/env bats
# Lifecycle drift guard: setup -> doctor -> teardown over a COPY of the real
# repo (real plugins/, claude/, scripts/), so a path or hook that setup
# registers but doctor flags as dangling, or teardown fails to remove, fails
# here. The idempotence/dangling suites use hand-built fixtures that can lag
# the real tree; this one cannot.
#
# Hermetic: HOME is the sandbox (helpers.bash), the repo is a throwaway copy,
# network tools are shimmed, claude/rtk are shimmed. Never touches ~/.claude.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO"
  cp -R "$REPO_ROOT/scripts" "$REPO_ROOT/claude" "$REPO_ROOT/plugins" "$FAKE_REPO/"
  cp "$REPO_ROOT/setup.sh" "$REPO_ROOT/teardown.sh" "$REPO_ROOT/doctor.sh" "$FAKE_REPO/"
  shim_claude enabled
  shim_rtk
  printf '[hooks]\nexclude_commands = ["git", "prettier", "eslint", "vitest"]\n' >"$FAKE_RTK_CONFIG"
}

teardown() {
  destroy_sandbox
}

@test "setup, then doctor reports clean, then teardown leaves nothing of ours" {
  run bash "$FAKE_REPO/setup.sh" --no-companions
  assert_success

  # Registered: every hook row, as a non-dangling command.
  run grep -c "$HOME/.claude/skills/" "$HOME/.claude/settings.json"
  [ "$output" -ge 4 ]
  [ -L "$HOME/.claude/skills/worktree-core" ]

  run bash "$FAKE_REPO/doctor.sh"
  assert_success
  assert_output_contains "no dangling hook entries or symlinks"

  run bash "$FAKE_REPO/teardown.sh"
  assert_success

  # Nothing of ours: no hook into our skills tree, no symlink into the repo.
  run grep -c "$HOME/.claude/skills" "$HOME/.claude/settings.json"
  [ "$output" = "0" ]
  run find "$HOME/.claude/skills" "$HOME/.claude/commands" -type l
  [ -z "$output" ]
}
