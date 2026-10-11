#!/usr/bin/env bats
# Idempotence tests for setup.sh and teardown.sh.
#
# setup.bats and teardown.bats already assert that a second run PRINTS nothing
# new ("Linked"/"Removed" absent from the output). That is a weaker claim than
# "the second run leaves the filesystem identical": a script could stay quiet
# while rewriting a file or appending a duplicate line. These tests snapshot
# the whole throwaway $HOME (entry type, symlink target, file content hash)
# before and after the extra run and require the snapshots to match, so the
# claim "running twice equals running once" is asserted on state, not output.
#
# Hermetic like every suite here: HOME is redirected into the sandbox and the
# network-blocking shims are on PATH (see helpers.bash). setup.sh runs with
# --no-companions so no companion installer is invoked.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts" "$FAKE_REPO/claude/commands" "$FAKE_REPO/claude/conventions"
  cp "$REPO_ROOT/setup.sh" "$REPO_ROOT/teardown.sh" "$FAKE_REPO/"
  chmod +x "$FAKE_REPO/setup.sh" "$FAKE_REPO/teardown.sh"
  cp -R "$REPO_ROOT/scripts/ts" "$FAKE_REPO/scripts/ts"
  local lib
  for lib in claude-md-lib.sh settings-lib.sh plugin-hooks.sh plugin-hooks.tsv symlink-lib.sh setup-plan-lib.sh \
    offer-safe-chain-permission.sh git-identity.sh check-companions.sh; do
    cp "$REPO_ROOT/scripts/$lib" "$FAKE_REPO/scripts/$lib"
  done
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh" \
    "$FAKE_REPO/scripts/git-identity.sh" "$FAKE_REPO/scripts/check-companions.sh"
  echo "# global instructions" >"$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" >"$FAKE_REPO/claude/commands/demo.md"
  echo "# another command" >"$FAKE_REPO/claude/commands/other.md"
  echo "## Convention one" >"$FAKE_REPO/claude/conventions/one.md"
  printf '# comment\n\none.md\n' >"$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  _add_plugin demo-plugin
  _add_plugin worktree-core
  _add_plugin memory-hygiene
  # Hook scripts for every row in scripts/plugin-hooks.tsv, so setup registers
  # (and teardown deregisters) the full hook set in settings.json.
  local wt="$FAKE_REPO/plugins/worktree-core/skills/git-worktree-usage/scripts"
  mkdir -p "$wt" "$FAKE_REPO/plugins/memory-hygiene/hooks/scripts"
  local s
  for s in require-worktree-hook.sh check-worktree-symlinks-hook.sh prune-merged-worktrees-hook.sh; do
    printf '#!/usr/bin/env bash\nexit 0\n' >"$wt/$s"
    chmod +x "$wt/$s"
  done
  printf '#!/usr/bin/env bash\nexit 0\n' \
    >"$FAKE_REPO/plugins/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
  chmod +x "$FAKE_REPO/plugins/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
}

teardown() {
  destroy_sandbox
}

_add_plugin() {
  mkdir -p "$FAKE_REPO/plugins/$1/.claude-plugin"
  printf '{"name":"%s","version":"0.1.0","description":"fixture"}\n' "$1" \
    >"$FAKE_REPO/plugins/$1/.claude-plugin/plugin.json"
}

run_setup() {
  run bash "$FAKE_REPO/setup.sh" --no-companions "$@"
}

run_teardown() {
  run bash "$FAKE_REPO/teardown.sh" "$@"
}

# One line per entry under $HOME: type, path, and either the symlink target or
# a content hash. Equal snapshots mean an identical tree.
snapshot_home() {
  local p
  (
    cd "$HOME" || exit 1
    find . | LC_ALL=C sort | while IFS= read -r p; do
      if [ -L "$p" ]; then
        echo "L $p -> $(readlink "$p")"
      elif [ -d "$p" ]; then
        echo "D $p"
      else
        echo "F $p $(shasum "$p" | cut -d' ' -f1)"
      fi
    done
  )
}

# A non-trivial starting HOME: user-owned CLAUDE.md content and a settings.json
# carrying keys setup/teardown must preserve.
seed_user_state() {
  mkdir -p "$HOME/.claude"
  printf '# my own notes\n' >"$HOME/.claude/CLAUDE.md"
  printf '{"theme":"dark","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/usr/bin/true"}]}]}}\n' \
    >"$HOME/.claude/settings.json"
}

@test "setup twice leaves the whole HOME tree identical to setup once" {
  seed_user_state
  run_setup
  assert_success
  local once
  once="$(snapshot_home)"
  run_setup
  assert_success
  [ "$(snapshot_home)" = "$once" ]
}

@test "setup twice from a clean HOME leaves the tree identical and prints no change lines" {
  run_setup
  assert_success
  local once
  once="$(snapshot_home)"
  run_setup
  assert_success
  [ "$(snapshot_home)" = "$once" ]
  refute_output_contains "Linked"
  refute_output_contains "Replacing"
  refute_output_contains "Created"
  refute_output_contains "Updated"
  refute_output_contains "Prepended"
}

@test "setup registers each hook exactly once and keeps unrelated settings across repeated runs" {
  seed_user_state
  run_setup
  assert_success
  run_setup
  assert_success
  run_setup
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
assert d['theme'] == 'dark', 'unrelated key lost'
cmds = [' '.join([h['command']] + h.get('args', [])) for ev in d['hooks'].values() for e in ev for h in e['hooks']]
assert cmds.count('/usr/bin/true') == 1, 'user hook duplicated or lost'
managed = [c for c in cmds if c != '/usr/bin/true']
assert len(managed) == 4, 'expected 4 managed hooks, got {}'.format(len(managed))
assert len(set(managed)) == 4, 'duplicate managed hook'
"
  [ "$status" -eq 0 ]
}

@test "setup twice with the same --skip is identical to once (deregistration is idempotent)" {
  seed_user_state
  run_setup --skip=worktree-core
  assert_success
  local once
  once="$(snapshot_home)"
  run_setup --skip=worktree-core
  assert_success
  [ "$(snapshot_home)" = "$once" ]
}

@test "teardown twice leaves the whole HOME tree identical to teardown once" {
  seed_user_state
  run_setup
  assert_success
  run_teardown
  assert_success
  local once
  once="$(snapshot_home)"
  run_teardown
  assert_success
  [ "$(snapshot_home)" = "$once" ]
  refute_output_contains "Removed"
  refute_output_contains "Restored"
}

@test "teardown removes every managed hook and keeps the user's own settings" {
  seed_user_state
  run_setup
  assert_success
  run_teardown
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
assert d['theme'] == 'dark', 'unrelated key lost'
cmds = [h['command'] for ev in d.get('hooks', {}).values() for e in ev for h in e['hooks']]
assert cmds == ['/usr/bin/true'], 'unexpected hooks left: {}'.format(cmds)
"
  [ "$status" -eq 0 ]
}

@test "teardown on a HOME setup never touched changes nothing" {
  seed_user_state
  local before
  before="$(snapshot_home)"
  run_teardown
  assert_success
  [ "$(snapshot_home)" = "$before" ]
}

@test "setup then teardown then setup ends in the same state as setup once" {
  seed_user_state
  run_setup
  assert_success
  local once
  once="$(snapshot_home)"
  run_teardown
  assert_success
  run_setup
  assert_success
  [ "$(snapshot_home)" = "$once" ]
}

@test "from a clean HOME, repeated setup/teardown cycles end in the same state as setup once" {
  run_setup
  assert_success
  local once
  once="$(snapshot_home)"
  run_teardown
  assert_success
  run_teardown
  assert_success
  run_setup
  assert_success
  run_setup
  assert_success
  [ "$(snapshot_home)" = "$once" ]
}
