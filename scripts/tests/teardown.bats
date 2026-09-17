#!/usr/bin/env bats
# Unit tests for teardown.sh — the symlink remover.
#
# Tests set up symlinks in the sandbox's HOME (the state left by setup.sh) and
# verify teardown.sh removes exactly what it owns and leaves everything else
# untouched. Nothing here can reach the developer's real ~/.claude.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO"
  cp "$REPO_ROOT/teardown.sh" "$FAKE_REPO/teardown.sh"
  chmod +x "$FAKE_REPO/teardown.sh"
  mkdir -p "$FAKE_REPO/claude/commands"
  echo "# global instructions" > "$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" > "$FAKE_REPO/claude/commands/demo.md"
  mkdir -p "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin"
  echo '{"name":"dfadler-agent-config"}' \
    > "$FAKE_REPO/plugins/dfadler-agent-config/.claude-plugin/plugin.json"
}

teardown() {
  destroy_sandbox
}

run_teardown() {
  run bash "$FAKE_REPO/teardown.sh"
}

# Lay out the three symlinks setup.sh would have created so each test starts
# in a realistic post-setup state without depending on setup.sh itself.
install_links() {
  mkdir -p "$HOME/.claude/commands" "$HOME/.claude/skills"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  ln -s "$FAKE_REPO/claude/commands/demo.md" "$HOME/.claude/commands/demo.md"
  ln -s "$FAKE_REPO/plugins/dfadler-agent-config" \
    "$HOME/.claude/skills/dfadler-agent-config"
}

@test "removes the repo CLAUDE.md symlink and restores non-empty CLAUDE.personal.md" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success

  # Symlink is gone; real file is restored with the personal content.
  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ -f "$HOME/.claude/CLAUDE.md" ]
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "personal content" ]
  # CLAUDE.personal.md was moved, not copied.
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "removes the repo CLAUDE.md symlink and removes an empty CLAUDE.personal.md" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "leaves CLAUDE.md alone when it is not a repo symlink" {
  mkdir -p "$HOME/.claude"
  echo "standalone config" > "$HOME/.claude/CLAUDE.md"

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "standalone config" ]
}

@test "removes command symlinks pointing into this repo" {
  install_links

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/commands/demo.md" ]
  [ ! -e "$HOME/.claude/commands/demo.md" ]
}

@test "removes plugin symlinks pointing into this repo" {
  install_links

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/skills/dfadler-agent-config" ]
  [ ! -e "$HOME/.claude/skills/dfadler-agent-config" ]
}

@test "leaves a foreign skills symlink untouched" {
  install_links
  mkdir -p "$SANDBOX/other-plugin"
  ln -s "$SANDBOX/other-plugin" "$HOME/.claude/skills/someone-elses"

  run_teardown
  assert_success

  [ "$(readlink "$HOME/.claude/skills/someone-elses")" = "$SANDBOX/other-plugin" ]
}

@test "is idempotent — a second run removes nothing and reports nothing" {
  install_links
  echo "personal" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success

  run_teardown
  assert_success
  refute_output_contains "Removed"
  refute_output_contains "Restored"
}

@test "--help prints usage and exits 0 without touching anything" {
  run bash "$FAKE_REPO/teardown.sh" --help
  assert_success
  assert_output_contains "--help"
  [ ! -e "$HOME/.claude" ]
}

@test "an unknown argument exits 2 and touches nothing" {
  run bash "$FAKE_REPO/teardown.sh" --nope
  assert_status 2
  assert_output_contains "Unknown argument: --nope"
  [ ! -e "$HOME/.claude" ]
}
