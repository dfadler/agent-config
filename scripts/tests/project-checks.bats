#!/usr/bin/env bats
# Report-only project checks in scripts/check-companions.sh (doctor): risky or
# stale allow rules in .claude/settings.local.json, and worktree count / disk
# use / autoPrune under .claude/worktrees. Hermetic: HOME and the project are
# throwaway dirs inside the sandbox; doctor runs with the project as cwd.

load helpers

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts" "$HOME/.claude"
  cp "$REPO_ROOT/scripts/check-companions.sh" "$REPO_ROOT/scripts/settings-lib.sh" \
    "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" "$REPO_ROOT/scripts/git-identity.sh" \
    "$FAKE_REPO/scripts/"
  chmod +x "$FAKE_REPO/scripts/"*.sh
  shim_claude enabled
  shim_rtk
  printf '[hooks]\nexclude_commands = ["git", "prettier", "eslint", "vitest"]\n' >"$FAKE_RTK_CONFIG"

  PROJ="$SANDBOX/proj"
  mkdir -p "$PROJ/.claude"
  git -C "$PROJ" init -q
  git -C "$PROJ" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
  unset WORKTREE_AUTO_PRUNE
}

teardown() {
  destroy_sandbox
}

run_doctor() {
  cd "$PROJ"
  run bash "$FAKE_REPO/scripts/check-companions.sh" "$@"
}

write_rules() {
  local rules="" r
  for r in "$@"; do rules+="\"$r\","; done
  printf '{"permissions":{"allow":[%s]}}\n' "${rules%,}" >"$PROJ/.claude/settings.local.json"
}

@test "clean: benign rules and no worktrees print one ok line, nothing else" {
  write_rules 'Bash(pnpm test:*)' 'Edit'
  touch "$PROJ/pnpm-lock.yaml"
  run_doctor
  assert_success
  assert_output_contains "no overly broad or stale allow rules"
  refute_output_contains "overly broad:"
  refute_output_contains "worktrees under"
}

@test "no settings.local.json: allow-rule check stays silent" {
  run_doctor
  assert_success
  refute_output_contains "allow rules"
}

@test "broad grants are flagged" {
  write_rules 'Bash(git push *)' 'Bash(git stash:*)' 'Bash(git checkout *)' 'Bash(gh pr merge *)' 'Bash(git push origin main)'
  run_doctor
  assert_success
  assert_output_contains "overly broad: Bash(git push *)"
  assert_output_contains "overly broad: Bash(git stash:*)"
  assert_output_contains "overly broad: Bash(git checkout *)"
  assert_output_contains "overly broad: Bash(gh pr merge *)"
  refute_output_contains "overly broad: Bash(git push origin main)"
  assert_output_contains "doctor never edits settings"
}

@test "bun rules flagged in a pnpm repo, not in a bun repo" {
  write_rules 'Bash(bun install)' 'Bash(bun run *)' 'Bash(pnpm install)'
  touch "$PROJ/pnpm-lock.yaml"
  run_doctor
  assert_output_contains "no longer uses (lockfiles: pnpm): Bash(bun install)"
  assert_output_contains "Bash(bun run *)"
  refute_output_contains "Bash(pnpm install)"
  rm "$PROJ/pnpm-lock.yaml"
  touch "$PROJ/bun.lock"
  run_doctor
  refute_output_contains "no longer uses (lockfiles: bun): Bash(bun"
}

@test "no lockfile: package-manager rules are not judged" {
  write_rules 'Bash(bun test)'
  run_doctor
  refute_output_contains "no longer uses"
}

@test "stale path and one-off literal are flagged; live path is not" {
  write_rules 'Bash(ls /Users/nobody/old-checkout/dist)' "Bash(git commit -m 'fix a thing')" "Bash(ls $PROJ/src)" 'Bash(git commit *)'
  run_doctor
  assert_output_contains "hard-coded path that no longer exists (/Users/nobody/old-checkout/dist)"
  assert_output_contains "one-off literal command: Bash(git commit -m 'fix a thing')"
  refute_output_contains "no longer exists ($PROJ/src)"
  refute_output_contains "one-off literal command: Bash(git commit *)"
}

@test "read-only rules get a move-to-shared suggestion, and files are untouched" {
  write_rules 'Bash(git status)' 'Bash(gh pr view *)' 'Bash(ls | rm -rf x)'
  before="$(cat "$PROJ/.claude/settings.local.json")"
  run_doctor --fix
  assert_success
  assert_output_contains "could live in shared .claude/settings.json"
  assert_output_contains "Bash(git status)"
  assert_output_contains "Bash(gh pr view *)"
  refute_output_contains "    Bash(ls | rm"
  [ "$(cat "$PROJ/.claude/settings.local.json")" = "$before" ]
}

@test "worktrees: count, size, and autoPrune unset nudge" {
  git -C "$PROJ" worktree add -q "$PROJ/.claude/worktrees/a" -b a
  git -C "$PROJ" worktree add -q "$PROJ/.claude/worktrees/b" -b b
  run_doctor
  assert_success
  assert_output_contains "2 worktrees under"
  assert_output_contains "MB)"
  assert_output_contains "worktree.autoPrune is not set"
}

@test "worktrees: autoPrune from settings or env silences the nudge" {
  git -C "$PROJ" worktree add -q "$PROJ/.claude/worktrees/a" -b a
  echo '{"worktree":{"autoPrune":true}}' >"$PROJ/.claude/settings.json"
  run_doctor
  assert_output_contains "1 worktrees under"
  assert_output_contains "worktree.autoPrune=true"
  refute_output_contains "is not set"
  echo '{}' >"$PROJ/.claude/settings.json"
  WORKTREE_AUTO_PRUNE=0 run_doctor
  assert_output_contains "WORKTREE_AUTO_PRUNE=0"
  refute_output_contains "is not set"
}

@test "worktrees: outside a git repo the worktree check is skipped" {
  PROJ="$SANDBOX/plain"
  mkdir -p "$PROJ/.claude"
  run_doctor
  assert_success
  refute_output_contains "worktrees under"
}
