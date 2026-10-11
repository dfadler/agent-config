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
  mkdir -p "$FAKE_REPO/claude/commands" "$FAKE_REPO/claude/conventions"
  echo "# global instructions" > "$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" > "$FAKE_REPO/claude/commands/demo.md"
  echo "## Convention one" > "$FAKE_REPO/claude/conventions/one.md"
  echo "## Convention two" > "$FAKE_REPO/claude/conventions/two.md"
  echo "## Convention three (opt-in only)" > "$FAKE_REPO/claude/conventions/three.md"
  printf '# comment, and a blank line below\n\none.md\ntwo.md\n' \
    > "$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  mkdir -p "$FAKE_REPO/plugins/demo-plugin/.claude-plugin"
  echo '{"name":"demo-plugin"}' \
    > "$FAKE_REPO/plugins/demo-plugin/.claude-plugin/plugin.json"
  mkdir -p "$FAKE_REPO/scripts"
  cp "$REPO_ROOT/scripts/claude-md-lib.sh" "$FAKE_REPO/scripts/claude-md-lib.sh"
  cp "$REPO_ROOT/scripts/settings-lib.sh" "$FAKE_REPO/scripts/settings-lib.sh"
  cp "$REPO_ROOT/scripts/plugin-hooks.sh" "$FAKE_REPO/scripts/plugin-hooks.sh"
  cp "$REPO_ROOT/scripts/plugin-hooks.tsv" "$FAKE_REPO/scripts/plugin-hooks.tsv"
  cp "$REPO_ROOT/scripts/plugin-hooks.sh" "$FAKE_REPO/scripts/plugin-hooks.sh"
  cp "$REPO_ROOT/scripts/symlink-lib.sh" "$FAKE_REPO/scripts/symlink-lib.sh"
  cp "$REPO_ROOT/scripts/setup-plan-lib.sh" "$FAKE_REPO/scripts/setup-plan-lib.sh"
  cp "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" \
    "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  cp "$REPO_ROOT/scripts/git-identity.sh" "$FAKE_REPO/scripts/git-identity.sh"
  chmod +x "$FAKE_REPO/scripts/git-identity.sh"
  cp "$REPO_ROOT/scripts/settings-lib.sh" "$FAKE_REPO/scripts/settings-lib.sh"
  cp "$REPO_ROOT/scripts/check-companions.sh" \
    "$FAKE_REPO/scripts/check-companions.sh"
  chmod +x "$FAKE_REPO/scripts/check-companions.sh"
}

teardown() {
  destroy_sandbox
}

run_setup() {
  run bash "$FAKE_REPO/setup.sh" --no-companions
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
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

@test "links the plugin as a directory, not its contents" {
  run_setup
  assert_success
  [ -L "$HOME/.claude/skills/demo-plugin" ]
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

# Regression: on macOS a volume can be reached via multiple paths (e.g.
# ~/Development and /Volumes/Development). Without cd -P, REPO_ROOT is the
# string of the path used to invoke the script, so symlinks created from one
# path alias look foreign when setup runs from another — producing false-alarm
# "Skipping — doesn't own" messages even though the symlinks are correct.
@test "recognises its own symlinks when invoked via a different path alias to the same dir" {
  run_setup
  assert_success
  # Create an alias: a symlink that resolves to the same physical directory.
  FAKE_REPO_ALIAS="$SANDBOX/repo-alias"
  ln -s "$FAKE_REPO" "$FAKE_REPO_ALIAS"
  # Re-run from the alias — BASH_SOURCE[0] will differ but cd -P must
  # resolve it to the same canonical path, so the existing skill symlink
  # (pointing to $FAKE_REPO/...) is recognised as this repo's own.
  run bash "$FAKE_REPO_ALIAS/setup.sh" --no-companions
  assert_success
  refute_output_contains "doesn't own"
  refute_output_contains "Skipping"
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
  ln -s "$FAKE_REPO/plugins/demo-plugin/skills/gh-attach-image" \
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
  # resolve_symlink_target cds into the target's PARENT, so that directory has to exist.
  mkdir -p "$FAKE_REPO/plugins/demo-plugin/skills"
  ln -s "../../../repo/plugins/demo-plugin/skills/old-skill" \
    "$HOME/.claude/skills/old-skill"
  # Sanity-check the fixture itself: if this relative target didn't actually
  # point into the repo, the test would pass for the wrong reason.
  [ "$(cd "$HOME/.claude/skills" && cd "$(dirname "$(readlink old-skill)")" && pwd)" \
    = "$FAKE_REPO/plugins/demo-plugin/skills" ]

  run_setup
  assert_success
  [ ! -L "$HOME/.claude/skills/old-skill" ]
}

@test "keeps the current plugin link across repeated runs" {
  run_setup
  assert_success
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
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
  assert_output_contains "--fix"
  [ ! -e "$HOME/.claude" ]
}

@test "an unknown argument exits 2 and links nothing" {
  run_setup_with --nope
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown argument: --nope"
  [ ! -e "$HOME/.claude" ]
}

# --- --skip / --list-features ------------------------------------------

@test "--list-features prints commands and plugins and links nothing" {
  run_setup_with --list-features
  assert_success
  assert_output_contains "Commands:"
  assert_output_contains "demo"
  assert_output_contains "Plugins:"
  assert_output_contains "demo-plugin"
  [ ! -e "$HOME/.claude" ]
}

@test "an unknown --skip feature exits 2 and links nothing" {
  run_setup_with --skip=not-a-real-feature
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown --skip feature(s): not-a-real-feature"
  [ ! -e "$HOME/.claude" ]
}

@test "--skip=<command> leaves that command unlinked but links everything else" {
  run_setup_with --skip=demo
  assert_success
  [ ! -e "$HOME/.claude/commands/demo.md" ]
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

@test "--skip=<plugin> leaves that plugin unlinked but links commands" {
  run_setup_with --skip=demo-plugin
  assert_success
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
}

@test "--skip accepts a comma-separated list across both namespaces" {
  run_setup_with --skip=demo,demo-plugin
  assert_success
  [ ! -e "$HOME/.claude/commands/demo.md" ]
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
}

@test "opting a command back out on a later run removes its previously-linked symlink" {
  run_setup
  assert_success
  [ -L "$HOME/.claude/commands/demo.md" ]
  run_setup_with --skip=demo
  assert_success
  assert_output_contains "Removed opted-out symlink"
  [ ! -e "$HOME/.claude/commands/demo.md" ]
}

@test "opting a plugin back out on a later run removes its previously-linked symlink" {
  run_setup
  assert_success
  [ -L "$HOME/.claude/skills/demo-plugin" ]
  run_setup_with --skip=demo-plugin
  assert_success
  assert_output_contains "Removed superseded symlink"
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
}

@test "re-running with the same --skip list is idempotent" {
  run_setup_with --skip=demo
  assert_success
  run_setup_with --skip=demo
  assert_success
  refute_output_contains "Linked"
  refute_output_contains "Removed"
}

@test "opting a command back in after a skip re-links it" {
  run_setup_with --skip=demo
  assert_success
  [ ! -e "$HOME/.claude/commands/demo.md" ]
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
}

# --- --include -----------------------------------------------------------

@test "--skip and --include together exits 2 and links nothing" {
  run_setup_with --skip=demo --include=demo-plugin
  [ "$status" -eq 2 ]
  assert_output_contains "--skip and --include cannot be combined."
  [ ! -e "$HOME/.claude" ]
}

@test "an unknown --include feature exits 2 and links nothing" {
  run_setup_with --include=not-a-real-feature
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown --include feature(s): not-a-real-feature"
  [ ! -e "$HOME/.claude" ]
}

@test "--include with no value exits 2 and links nothing, rather than installing everything" {
  run_setup_with --include=
  [ "$status" -eq 2 ]
  assert_output_contains "--include requires at least one feature name."
  [ ! -e "$HOME/.claude" ]
}

@test "--include with only delimiters exits 2 and links nothing" {
  run_setup_with --include=,,,
  [ "$status" -eq 2 ]
  assert_output_contains "--include requires at least one feature name."
  [ ! -e "$HOME/.claude" ]
}

@test "--skip=<feature> --include= (empty) is still treated as combining the flags" {
  run_setup_with --skip=demo --include=
  [ "$status" -eq 2 ]
  assert_output_contains "--skip and --include cannot be combined."
  [ ! -e "$HOME/.claude" ]
}

@test "--skip= (empty) alone is a no-op — still installs everything" {
  run_setup_with --skip=
  assert_success
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

@test "--include=<command> links only that command, not the plugin" {
  run_setup_with --include=demo
  assert_success
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
}

@test "--include=<plugin> links only that plugin, not the command" {
  run_setup_with --include=demo-plugin
  assert_success
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
  [ ! -e "$HOME/.claude/commands/demo.md" ]
}

@test "--include accepts a comma-separated list across both namespaces" {
  run_setup_with --include=demo,demo-plugin
  assert_success
  [ "$(readlink "$HOME/.claude/commands/demo.md")" = "$FAKE_REPO/claude/commands/demo.md" ]
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

@test "narrowing --include on a later run removes the previously-linked command" {
  run_setup_with --include=demo,demo-plugin
  assert_success
  [ -L "$HOME/.claude/commands/demo.md" ]
  run_setup_with --include=demo-plugin
  assert_success
  assert_output_contains "Removed opted-out symlink"
  [ ! -e "$HOME/.claude/commands/demo.md" ]
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

@test "narrowing --include on a later run removes the previously-linked plugin" {
  run_setup_with --include=demo,demo-plugin
  assert_success
  [ -L "$HOME/.claude/skills/demo-plugin" ]
  run_setup_with --include=demo
  assert_success
  assert_output_contains "Removed superseded symlink"
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
}

@test "re-running with the same --include list is idempotent" {
  run_setup_with --include=demo
  assert_success
  run_setup_with --include=demo
  assert_success
  refute_output_contains "Linked"
  refute_output_contains "Removed"
}

@test "--include prints the exact re-run command as the last output" {
  run_setup_with --no-companions --include=demo,demo-plugin
  assert_success
  [ "${lines[$((${#lines[@]} - 2))]}" = "To re-run with this feature selection:" ]
  [ "${lines[$((${#lines[@]} - 1))]}" = "  ./setup.sh --include=demo,demo-plugin" ]
}

@test "--skip prints the exact re-run command as the last output" {
  run_setup_with --no-companions --skip=demo
  assert_success
  [ "${lines[$((${#lines[@]} - 2))]}" = "To re-run with this feature selection:" ]
  [ "${lines[$((${#lines[@]} - 1))]}" = "  ./setup.sh --skip=demo" ]
}

@test "no re-run hint when neither --skip nor --include is used" {
  run_setup
  assert_success
  refute_output_contains "To re-run"
}

@test "dropping --include on a later run re-links everything" {
  run_setup_with --include=demo
  assert_success
  [ ! -e "$HOME/.claude/skills/demo-plugin" ]
  run_setup
  assert_success
  [ "$(readlink "$HOME/.claude/skills/demo-plugin")" = "$FAKE_REPO/plugins/demo-plugin" ]
}

# ---------------------------------------------------------------------------
# Hook registration in ~/.claude/settings.json
# ---------------------------------------------------------------------------

_add_worktree_core_fixture() {
  mkdir -p "$FAKE_REPO/plugins/worktree-core/.claude-plugin"
  printf '{"name":"worktree-core","version":"0.1.0","description":"fixture"}\n' \
    >"$FAKE_REPO/plugins/worktree-core/.claude-plugin/plugin.json"
  mkdir -p "$FAKE_REPO/plugins/worktree-core/skills/git-worktree-usage/scripts"
  for script in require-worktree-hook.sh check-worktree-symlinks-hook.sh prune-merged-worktrees-hook.sh; do
    printf '#!/usr/bin/env bash\nexit 0\n' \
      >"$FAKE_REPO/plugins/worktree-core/skills/git-worktree-usage/scripts/$script"
    chmod +x "$FAKE_REPO/plugins/worktree-core/skills/git-worktree-usage/scripts/$script"
  done
}

_add_memory_hygiene_hook_fixture() {
  mkdir -p "$FAKE_REPO/plugins/memory-hygiene/.claude-plugin"
  echo '{"name":"memory-hygiene"}' >"$FAKE_REPO/plugins/memory-hygiene/.claude-plugin/plugin.json"
  mkdir -p "$FAKE_REPO/plugins/memory-hygiene/hooks/scripts"
  printf '#!/usr/bin/env bash\nexit 0\n' \
    >"$FAKE_REPO/plugins/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
  chmod +x "$FAKE_REPO/plugins/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
}

@test "hook registration: worktree-core installs PreToolUse hook in settings.json" {
  _add_worktree_core_fixture
  run_setup
  assert_success
  HOOK_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts\""
  run python3 -c "
import json, sys
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e.get('hooks', [])]
sys.exit(0 if '$HOOK_CMD' in cmds else 1)
"
  [ "$status" -eq 0 ]
}

@test "hook registration: idempotent on re-run (no duplicate entry)" {
  _add_worktree_core_fixture
  run_setup
  assert_success
  run_setup
  assert_success
  HOOK_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts\""
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e.get('hooks', [])]
count = cmds.count('$HOOK_CMD')
assert count == 1, 'expected 1, got {}'.format(count)
"
  [ "$status" -eq 0 ]
}

@test "hook registration: --skip=worktree-core deregisters the hook" {
  _add_worktree_core_fixture
  run_setup
  assert_success
  run_setup_with --skip=worktree-core
  assert_success
  HOOK_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts\""
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('PreToolUse', []) for h in e.get('hooks', [])]
assert '$HOOK_CMD' not in cmds, 'hook still present after skip'
"
  [ "$status" -eq 0 ]
}

@test "hook registration: worktree-core installs both SessionStart hooks, without a matcher key" {
  _add_worktree_core_fixture
  run_setup
  assert_success
  SYMLINK_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/check-worktree-symlinks-hook.ts\""
  PRUNE_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/prune-merged-worktrees-hook.ts\""
  run python3 -c "
import json, sys
d = json.load(open('$HOME/.claude/settings.json'))
entries = d.get('hooks', {}).get('SessionStart', [])
cmds = [h['command'] for e in entries for h in e.get('hooks', [])]
assert '$SYMLINK_CMD' in cmds, 'symlink-check hook missing'
assert '$PRUNE_CMD' in cmds, 'auto-prune hook missing'
assert all('matcher' not in e for e in entries), 'SessionStart entry should have no matcher key'
"
  [ "$status" -eq 0 ]
}

@test "hook registration: --skip=worktree-core deregisters both SessionStart hooks" {
  _add_worktree_core_fixture
  run_setup
  assert_success
  run_setup_with --skip=worktree-core
  assert_success
  SYMLINK_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/check-worktree-symlinks-hook.ts\""
  PRUNE_CMD="node \"$HOME/.claude/skills/worktree-core/scripts/ts/prune-merged-worktrees-hook.ts\""
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('SessionStart', []) for h in e.get('hooks', [])]
assert '$SYMLINK_CMD' not in cmds, 'symlink-check hook still present after skip'
assert '$PRUNE_CMD' not in cmds, 'auto-prune hook still present after skip'
"
  [ "$status" -eq 0 ]
}

@test "hook registration: memory-hygiene installs the memory-hygiene Stop hook, without a matcher key" {
  _add_memory_hygiene_hook_fixture
  run_setup
  assert_success
  HOOK_CMD="node \"$HOME/.claude/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\""
  run python3 -c "
import json, sys
d = json.load(open('$HOME/.claude/settings.json'))
entries = d.get('hooks', {}).get('Stop', [])
cmds = [h['command'] for e in entries for h in e.get('hooks', [])]
assert '$HOOK_CMD' in cmds, 'memory-hygiene hook missing'
assert all('matcher' not in e for e in entries), 'Stop entry should have no matcher key'
"
  [ "$status" -eq 0 ]
}

@test "hook registration: --skip=memory-hygiene deregisters the memory-hygiene Stop hook" {
  _add_memory_hygiene_hook_fixture
  run_setup
  assert_success
  run_setup_with --skip=memory-hygiene
  assert_success
  HOOK_CMD="node \"$HOME/.claude/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\""
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for e in d.get('hooks', {}).get('Stop', []) for h in e.get('hooks', [])]
assert '$HOOK_CMD' not in cmds, 'hook still present after skip'
"
  [ "$status" -eq 0 ]
}

@test "hook migration: setup replaces retired .sh shim registrations with the node .ts command" {
  _add_worktree_core_fixture
  _add_memory_hygiene_hook_fixture
  mkdir -p "$HOME/.claude"
  LEGACY="$HOME/.claude/skills/worktree-core/skills/git-worktree-usage/scripts/require-worktree-hook.sh"
  LEGACY_MH="$HOME/.claude/skills/memory-hygiene/hooks/scripts/memory-hygiene-stop-hook.sh"
  python3 - "$HOME/.claude/settings.json" "$LEGACY" "$LEGACY_MH" <<'PY'
import json, sys
legacy, mh = sys.argv[2], sys.argv[3]
json.dump({"hooks": {
  "PreToolUse": [{"matcher": "Edit|Write", "hooks": [{"type": "command", "command": legacy}]}],
  "Stop": [{"hooks": [{"type": "command", "command": mh}, {"type": "command", "command": "foreign-stop"}]}],
}}, open(sys.argv[1], "w"))
PY
  run_setup
  assert_success
  run python3 -c "
import json
d = json.load(open('$HOME/.claude/settings.json'))
cmds = [h['command'] for ev in d['hooks'].values() for e in ev for h in e['hooks']]
assert '$LEGACY' not in cmds and '$LEGACY_MH' not in cmds, cmds
assert 'node \"$HOME/.claude/skills/worktree-core/scripts/ts/require-worktree-hook.ts\"' in cmds, cmds
assert 'node \"$HOME/.claude/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\"' in cmds, cmds
assert 'foreign-stop' in cmds, cmds
"
  [ "$status" -eq 0 ]
}
