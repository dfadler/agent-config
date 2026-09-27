#!/usr/bin/env bats
#
# Direct unit tests for plugins/worktree-core/skills/git-worktree-usage/scripts/
# worktree-hook-lib.sh's resolve_enable_mode — the shared enable-mode
# precedence resolver used by require-worktree-hook.sh,
# prune-merged-worktrees-hook.sh, and check-worktree-symlinks-hook.sh.
#
# The three hook .bats files already exercise resolve_enable_mode indirectly
# through each hook's own vocabulary; this file tests the resolver itself in
# isolation so a precedence or validation regression here fails close to the
# cause instead of only showing up as a hook-level test failure.
#
# Hermetic: sources the real lib into a throwaway directory alongside a fake
# `git` shim that returns a controllable --show-toplevel; nothing touches a
# real git repo or the developer's own settings.json.

HOOK_LIB="$BATS_TEST_DIRNAME/../../plugins/worktree-core/skills/git-worktree-usage/scripts/worktree-hook-lib.sh"

setup() {
  TMP="$(mktemp -d)"
  GIT_SHIM="$TMP/shim-bin"
  FAKE_TOPLEVEL="$TMP/toplevel"
  mkdir -p "$GIT_SHIM" "$FAKE_TOPLEVEL/.claude"

  cat >"$GIT_SHIM/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "rev-parse" ] && [ "\$2" = "--show-toplevel" ]; then
  echo "$FAKE_TOPLEVEL"
  exit 0
fi
exec "$(command -v git)" "\$@"
EOF
  chmod +x "$GIT_SHIM/git"
  export PATH="$GIT_SHIM:$PATH"

  # shellcheck source=/dev/null
  source "$HOOK_LIB"
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

_write_settings() {
  printf '%s\n' "$1" >"$FAKE_TOPLEVEL/.claude/settings.json"
}

@test "nothing configured: returns the default" {
  run resolve_enable_mode WORKTREE_TEST_VAR '.worktree.test // "unset"' off off warn block
  [ "$status" -eq 0 ]
  [ "$output" = "off" ]
}

@test "nothing configured, empty-string default (unconfigured sentinel): returns empty" {
  run resolve_enable_mode WORKTREE_TEST_VAR '.worktree.test // "unset"' "" on off
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "env var literal value matching valid_values wins over settings" {
  _write_settings '{"worktree":{"test":"block"}}'
  run env WORKTREE_TEST_VAR=warn bash -c \
    'source "'"$HOOK_LIB"'"; resolve_enable_mode WORKTREE_TEST_VAR ".worktree.test" off off warn block'
  [ "$status" -eq 0 ]
  [ "$output" = "warn" ]
}

@test "env var boolean synonyms normalize to on/off" {
  for val in 0 false no off; do
    run env WORKTREE_TEST_VAR="$val" bash -c \
      'source "'"$HOOK_LIB"'"; resolve_enable_mode WORKTREE_TEST_VAR ".worktree.test" off on off'
    [ "$status" -eq 0 ]
    [ "$output" = "off" ]
  done
  for val in 1 true yes on; do
    run env WORKTREE_TEST_VAR="$val" bash -c \
      'source "'"$HOOK_LIB"'"; resolve_enable_mode WORKTREE_TEST_VAR ".worktree.test" off on off'
    [ "$status" -eq 0 ]
    [ "$output" = "on" ]
  done
}

@test "env var value not in valid_values falls through to settings" {
  _write_settings '{"worktree":{"test":"warn"}}'
  run env WORKTREE_TEST_VAR=1 bash -c \
    'source "'"$HOOK_LIB"'"; resolve_enable_mode WORKTREE_TEST_VAR ".worktree.test" off off warn block'
  [ "$status" -eq 0 ]
  [ "$output" = "warn" ]
}

@test "settings.json value matching valid_values wins over default" {
  _write_settings '{"worktree":{"test":"on"}}'
  run resolve_enable_mode WORKTREE_TEST_VAR '.worktree.test // "unset"' off on off
  [ "$status" -eq 0 ]
  [ "$output" = "on" ]
}

@test "settings.json value not in valid_values falls back to default" {
  _write_settings '{"worktree":{"test":"maybe"}}'
  run resolve_enable_mode WORKTREE_TEST_VAR '.worktree.test // "unset"' off on off
  [ "$status" -eq 0 ]
  [ "$output" = "off" ]
}

@test "settings.json value has no synonym translation (a literal boolean string doesn't match on/off)" {
  _write_settings '{"worktree":{"test":true}}'
  run resolve_enable_mode WORKTREE_TEST_VAR '.worktree.test' off on off
  [ "$status" -eq 0 ]
  [ "$output" = "off" ]
}

@test "jq expression can embed its own translation (e.g. JSON boolean to on/off)" {
  _write_settings '{"worktree":{"test":true}}'
  run resolve_enable_mode WORKTREE_TEST_VAR \
    '.worktree.test | if . == true then "on" elif . == false then "off" else "unset" end' \
    "" on off
  [ "$status" -eq 0 ]
  [ "$output" = "on" ]
}
