#!/usr/bin/env bats
# Unit tests for scripts/git-identity.sh

load helpers

setup() {
  make_sandbox
  REPO_DIR="$SANDBOX/repo"
  mkdir -p "$REPO_DIR"
  git -C "$REPO_DIR" init -q
  # A sandboxed HOME has no global gitconfig, so init leaves user.name/email
  # unset unless a test sets them locally below.
}

teardown() {
  destroy_sandbox
}

check() {
  run bash "$REPO_ROOT/scripts/git-identity.sh"
}

@test "fails loudly when neither user.name nor user.email is configured" {
  cd "$REPO_DIR"
  check
  assert_failure
  assert_output_contains "user.name"
  assert_output_contains "user.email"
}

@test "fails loudly when only user.email is configured" {
  cd "$REPO_DIR"
  git config user.email "dev@example.com"
  check
  assert_failure
  assert_output_contains "not configured: user.name"
}

@test "fails loudly when only user.name is configured" {
  cd "$REPO_DIR"
  git config user.name "Dev Name"
  check
  assert_failure
  assert_output_contains "not configured: user.email"
}

@test "prints exports for both when fully configured" {
  cd "$REPO_DIR"
  git config user.name "Dev Name"
  git config user.email "dev@example.com"
  check
  assert_success
  assert_output_contains "export GIT_AUTHOR_NAME=Dev\\ Name"
  assert_output_contains "export GIT_AUTHOR_EMAIL=dev@example.com"
  assert_output_contains "export GIT_COMMITTER_NAME=Dev\\ Name"
  assert_output_contains "export GIT_COMMITTER_EMAIL=dev@example.com"
}

@test "output is eval-safe even with special characters in the name" {
  cd "$REPO_DIR"
  git config user.name 'Dev "Nickname" O'"'"'Name'
  git config user.email "dev@example.com"
  check
  assert_success
  eval "$output"
  [ "$GIT_AUTHOR_NAME" = 'Dev "Nickname" O'"'"'Name' ]
  [ "$GIT_AUTHOR_EMAIL" = "dev@example.com" ]
}

@test "local repo config takes precedence over global (git's own resolution)" {
  git config --global user.name "Global Name"
  git config --global user.email "global@example.com"
  cd "$REPO_DIR"
  git config user.name "Local Name"
  git config user.email "local@example.com"
  check
  assert_success
  assert_output_contains "export GIT_AUTHOR_NAME=Local\\ Name"
  assert_output_contains "export GIT_AUTHOR_EMAIL=local@example.com"
}
