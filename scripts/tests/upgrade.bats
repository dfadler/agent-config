#!/usr/bin/env bats
# upgrade.sh: pull --ff-only, ./setup.sh, ./doctor.sh --fix, stopping at the first failure.
#
# Hermetic: a throwaway clone with a local bare origin (make_git_sandbox), and
# stub setup.sh/doctor.sh that only log their arguments. The real repo is never
# pulled or modified.

load helpers

setup() {
  make_git_sandbox
  cp "$REPO_ROOT/upgrade.sh" "$REPO/upgrade.sh"
  _stub setup.sh 0
  _stub doctor.sh 0
  chmod +x "$REPO/upgrade.sh"
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "add scripts"
  git -C "$REPO" push -q origin main
  CALLS="$SANDBOX/calls"
  export CALLS
  : >"$CALLS"
}

teardown() {
  destroy_sandbox
}

# _stub NAME EXIT: a script that records "NAME args" in $CALLS and exits EXIT.
_stub() {
  printf '#!/usr/bin/env bash\necho "%s $*" >> "$CALLS"\nexit %s\n' "$1" "$2" >"$REPO/$1"
  chmod +x "$REPO/$1"
}

# Push one more commit to origin from a second clone, so REPO is behind.
_push_upstream_commit() {
  git clone -q "$ORIGIN" "$SANDBOX/other"
  git -C "$SANDBOX/other" commit -q --allow-empty -m "upstream change"
  git -C "$SANDBOX/other" push -q origin main
}

@test "pulls, then runs setup and doctor --fix in order" {
  _push_upstream_commit
  run bash "$REPO/upgrade.sh"
  assert_success
  [ "$(git -C "$REPO" log -1 --format=%s)" = "upstream change" ]
  [ "$(cat "$CALLS")" = "$(printf 'setup.sh \ndoctor.sh --fix')" ]
}

@test "refuses when not on main" {
  git -C "$REPO" checkout -q -b feature
  run bash "$REPO/upgrade.sh"
  assert_failure
  assert_output_contains "not on main"
  [ ! -s "$CALLS" ]
}

@test "refuses when the tree is dirty" {
  echo x >"$REPO/untracked"
  run bash "$REPO/upgrade.sh"
  assert_failure
  assert_output_contains "uncommitted changes"
  [ ! -s "$CALLS" ]
}

@test "refuses when main cannot fast-forward" {
  _push_upstream_commit
  git -C "$REPO" commit -q --allow-empty -m "local divergence"
  run bash "$REPO/upgrade.sh"
  assert_failure
  assert_output_contains "could not fast-forward"
  [ ! -s "$CALLS" ]
}

@test "a failing setup stops before doctor" {
  _stub setup.sh 3
  git -C "$REPO" commit -q -am "failing setup"
  run bash "$REPO/upgrade.sh"
  assert_failure
  assert_output_contains "setup.sh failed"
  [ "$(cat "$CALLS")" = "setup.sh " ]
}

@test "--plan runs setup --plan and report-only doctor without pulling" {
  _push_upstream_commit
  run bash "$REPO/upgrade.sh" --plan
  assert_success
  [ "$(git -C "$REPO" log -1 --format=%s)" = "add scripts" ]
  [ "$(cat "$CALLS")" = "$(printf 'setup.sh --plan\ndoctor.sh ')" ]
}

@test "--help documents usage; unknown args fail" {
  run bash "$REPO/upgrade.sh" --help
  assert_success
  assert_output_contains "Usage: ./upgrade.sh"
  run bash "$REPO/upgrade.sh" --bogus
  assert_status 2
}
