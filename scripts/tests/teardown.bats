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
  mkdir -p "$FAKE_REPO/scripts"
  cp "$REPO_ROOT/scripts/claude-md-lib.sh" "$FAKE_REPO/scripts/claude-md-lib.sh"
  cp "$REPO_ROOT/scripts/settings-lib.sh" "$FAKE_REPO/scripts/settings-lib.sh"
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
  run bash "$FAKE_REPO/teardown.sh" "$@"
}

# Lay out the state current setup.sh produces: a generated CLAUDE.md with the
# managed section, plus command and plugin symlinks.
install_links() {
  mkdir -p "$HOME/.claude/commands" "$HOME/.claude/skills"
  # Generated CLAUDE.md (current format).
  printf '%s\n%s\n%s\n%s\n' \
    "# >>> agent-config managed begin <<<" \
    "@CLAUDE.personal.md" \
    "@$FAKE_REPO/claude/CLAUDE.md" \
    "# >>> agent-config managed end <<<" \
    > "$HOME/.claude/CLAUDE.md"
  ln -s "$FAKE_REPO/claude/commands/demo.md" "$HOME/.claude/commands/demo.md"
  ln -s "$FAKE_REPO/plugins/dfadler-agent-config" \
    "$HOME/.claude/skills/dfadler-agent-config"
}

# Legacy state: a symlink to the repo (pre-managed-section format).
install_legacy_links() {
  mkdir -p "$HOME/.claude/commands" "$HOME/.claude/skills"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  ln -s "$FAKE_REPO/claude/commands/demo.md" "$HOME/.claude/commands/demo.md"
  ln -s "$FAKE_REPO/plugins/dfadler-agent-config" \
    "$HOME/.claude/skills/dfadler-agent-config"
}

@test "removes managed section from generated CLAUDE.md and restores non-empty CLAUDE.personal.md" {
  mkdir -p "$HOME/.claude"
  printf '%s\n%s\n%s\n%s\n' \
    "# >>> agent-config managed begin <<<" \
    "@CLAUDE.personal.md" \
    "@$FAKE_REPO/claude/CLAUDE.md" \
    "# >>> agent-config managed end <<<" \
    > "$HOME/.claude/CLAUDE.md"
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success
  assert_output_contains "Removed empty"
  # Managed section gone; CLAUDE.personal.md content restored.
  [ ! -e "$HOME/.claude/CLAUDE.md" ] || ! grep -qF "agent-config managed" "$HOME/.claude/CLAUDE.md"
  [ -f "$HOME/.claude/CLAUDE.md" ]
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "personal content" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "removes managed section but preserves user additions below it" {
  mkdir -p "$HOME/.claude"
  printf '%s\n%s\n%s\n%s\n\nUser-added: some custom instruction\n' \
    "# >>> agent-config managed begin <<<" \
    "@CLAUDE.personal.md" \
    "@$FAKE_REPO/claude/CLAUDE.md" \
    "# >>> agent-config managed end <<<" \
    > "$HOME/.claude/CLAUDE.md"

  run_teardown
  assert_success
  assert_output_contains "Removed managed section"
  grep -q "User-added: some custom instruction" "$HOME/.claude/CLAUDE.md"
  ! grep -qF "agent-config managed begin" "$HOME/.claude/CLAUDE.md"
}

@test "removes generated CLAUDE.md and removes empty CLAUDE.personal.md (with setup-managed marker)" {
  mkdir -p "$HOME/.claude"
  printf '%s\n%s\n%s\n%s\n' \
    "# >>> agent-config managed begin <<<" \
    "@CLAUDE.personal.md" \
    "@$FAKE_REPO/claude/CLAUDE.md" \
    "# >>> agent-config managed end <<<" \
    > "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"
  touch "$HOME/.claude/CLAUDE.personal.md.setup-managed"

  run_teardown
  assert_success

  [ ! -e "$HOME/.claude/CLAUDE.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md.setup-managed" ]
}

@test "leaves a user-owned empty CLAUDE.personal.md untouched (no setup-managed marker)" {
  mkdir -p "$HOME/.claude"
  printf '%s\n%s\n%s\n%s\n' \
    "# >>> agent-config managed begin <<<" \
    "@CLAUDE.personal.md" \
    "@$FAKE_REPO/claude/CLAUDE.md" \
    "# >>> agent-config managed end <<<" \
    > "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success

  [ -f "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "leaves CLAUDE.md alone when it has no managed section" {
  mkdir -p "$HOME/.claude"
  echo "standalone config" > "$HOME/.claude/CLAUDE.md"

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "standalone config" ]
}

# Legacy backward-compat: teardown.sh must still handle installations made
# before the managed-section format was introduced (symlink format).
@test "legacy: removes the repo CLAUDE.md symlink and restores non-empty CLAUDE.personal.md" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ -f "$HOME/.claude/CLAUDE.md" ]
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "personal content" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "legacy: removes the repo CLAUDE.md symlink and removes an empty CLAUDE.personal.md (with setup-managed marker)" {
  mkdir -p "$HOME/.claude"
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"
  touch "$HOME/.claude/CLAUDE.personal.md.setup-managed"

  run_teardown
  assert_success

  [ ! -L "$HOME/.claude/CLAUDE.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md" ]
  [ ! -e "$HOME/.claude/CLAUDE.personal.md.setup-managed" ]
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

  # Generated CLAUDE.md was removed (empty after stripping managed section)
  # and CLAUDE.personal.md content was restored to CLAUDE.md on the first run;
  # a second run has nothing left to do.
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

# ---------------------------------------------------------------------------
# Selective flags: --commands / --plugins / --claude-md
# ---------------------------------------------------------------------------

@test "--commands only unlinks commands, leaving plugins and CLAUDE.md alone" {
  install_links
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown --commands
  assert_success

  [ ! -e "$HOME/.claude/commands/demo.md" ]
  [ -L "$HOME/.claude/skills/dfadler-agent-config" ]
  grep -qF "agent-config managed" "$HOME/.claude/CLAUDE.md"
  [ -f "$HOME/.claude/CLAUDE.personal.md" ]
}

@test "--plugins only unlinks plugins and deregisters the hook, leaving commands and CLAUDE.md alone" {
  install_links
  HOOK_CMD="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  python3 -c "
import json
d = {'hooks': {'PreToolUse': [{'matcher': 'Edit|Write', 'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]}}
open('$HOME/.claude/settings.json', 'w').write(json.dumps(d))
"

  run_teardown --plugins
  assert_success

  [ ! -e "$HOME/.claude/skills/dfadler-agent-config" ]
  [ -L "$HOME/.claude/commands/demo.md" ]
  grep -qF "agent-config managed" "$HOME/.claude/CLAUDE.md"
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e.get('hooks', [])]
assert '$HOOK_CMD' not in cmds, 'hook still present after teardown'
"
  [ "$status" -eq 0 ]
}

@test "--claude-md only restores CLAUDE.md, leaving commands and plugins symlinks alone" {
  install_links
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown --claude-md
  assert_success

  [ ! -e "$HOME/.claude/CLAUDE.md" ] || ! grep -qF "agent-config managed" "$HOME/.claude/CLAUDE.md"
  [ "$(cat "$HOME/.claude/CLAUDE.md")" = "personal content" ]
  [ -L "$HOME/.claude/commands/demo.md" ]
  [ -L "$HOME/.claude/skills/dfadler-agent-config" ]
}

@test "--commands --plugins together unlink both but leave CLAUDE.md alone" {
  install_links
  echo "personal content" > "$HOME/.claude/CLAUDE.personal.md"

  run_teardown --commands --plugins
  assert_success

  [ ! -e "$HOME/.claude/commands/demo.md" ]
  [ ! -e "$HOME/.claude/skills/dfadler-agent-config" ]
  grep -qF "agent-config managed" "$HOME/.claude/CLAUDE.md"
  [ -f "$HOME/.claude/CLAUDE.personal.md" ]
}

# ---------------------------------------------------------------------------
# Hook deregistration from ~/.claude/settings.json
# ---------------------------------------------------------------------------

@test "hook deregistration: removes worktree-core PreToolUse hook from settings.json" {
  HOOK_CMD="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  mkdir -p "$HOME/.claude"
  python3 -c "
import json
d = {'hooks': {'PreToolUse': [{'matcher': 'Edit|Write', 'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]}}
open('$HOME/.claude/settings.json', 'w').write(json.dumps(d))
"
  run_teardown
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e.get('hooks', [])]
assert '$HOOK_CMD' not in cmds, 'hook still present after teardown'
"
  [ "$status" -eq 0 ]
}

@test "hook deregistration: no-op when settings.json has no PreToolUse hook" {
  mkdir -p "$HOME/.claude"
  printf '{}' >"$HOME/.claude/settings.json"
  install_links
  run_teardown
  assert_success
}

@test "hook deregistration: removes worktree-core SessionStart hooks from settings.json" {
  SYMLINK_CMD="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/check-worktree-symlinks-hook.sh"
  PRUNE_CMD="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/prune-merged-worktrees-hook.sh"
  mkdir -p "$HOME/.claude"
  python3 -c "
import json
d = {'hooks': {'SessionStart': [{'hooks': [
  {'type': 'command', 'command': '$SYMLINK_CMD'},
  {'type': 'command', 'command': '$PRUNE_CMD'},
]}]}}
open('$HOME/.claude/settings.json', 'w').write(json.dumps(d))
"
  run_teardown
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('SessionStart', []) for h in e.get('hooks', [])]
assert '$SYMLINK_CMD' not in cmds, 'symlink-check hook still present after teardown'
assert '$PRUNE_CMD' not in cmds, 'auto-prune hook still present after teardown'
"
  [ "$status" -eq 0 ]
}

@test "hook deregistration: removes the memory-hygiene Stop hook from settings.json" {
  HOOK_CMD="$HOME/.claude/skills/dfadler-agent-config/hooks/scripts/memory-hygiene-stop-hook.sh"
  mkdir -p "$HOME/.claude"
  python3 -c "
import json
d = {'hooks': {'Stop': [{'hooks': [{'type': 'command', 'command': '$HOOK_CMD'}]}]}}
open('$HOME/.claude/settings.json', 'w').write(json.dumps(d))
"
  run_teardown
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('Stop', []) for h in e.get('hooks', [])]
assert '$HOOK_CMD' not in cmds, 'hook still present after teardown'
"
  [ "$status" -eq 0 ]
}
