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
}

teardown() {
  destroy_sandbox
}

run_setup() {
  run bash "$FAKE_REPO/setup.sh"
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
