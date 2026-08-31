#!/usr/bin/env bats
# Unit tests for session-sync.sh — the SessionStart-hook sync script.
#
# This is the first script in the repo that runs REAL git against a remote
# (fetch + a fast-forward merge), so it uses make_git_sandbox (helpers.bash)
# rather than the plain HOME-only sandbox: a throwaway local bare "origin"
# and a clone, both confined to the sandbox, so nothing here can reach the
# network or the developer's real checkout. Ported from dfadler.com's
# prune-merged-worktrees.bats, which established the same local-origin
# pattern for a script with the same shape (real git, hermetic remote).
#
# setup.sh itself is stubbed rather than run for real: it has its own
# dedicated setup.bats, and this suite only needs to know THAT it ran, not
# re-verify everything it does.

load helpers

setup() {
  make_git_sandbox
  REAL_GIT="$(command -v git)"
  export REAL_GIT

  mkdir -p "$REPO/scripts"
  cp "$REPO_ROOT/scripts/session-sync.sh" "$REPO/scripts/session-sync.sh"
  chmod +x "$REPO/scripts/session-sync.sh"

  FAKE_SETUP_MARKER="$SANDBOX/setup-ran"
  export FAKE_SETUP_MARKER
  rm -f "$FAKE_SETUP_MARKER"
  cat > "$REPO/setup.sh" <<EOF
#!/usr/bin/env bash
set -uo pipefail
echo "fake setup.sh ran"
: > "$FAKE_SETUP_MARKER"
EOF
  chmod +x "$REPO/setup.sh"

  # Commit and push the fixture's own scripts, so the baseline REPO starts
  # clean, on main, and in sync with origin — the state every "should
  # proceed" test starts from.
  git -C "$REPO" add scripts/session-sync.sh setup.sh
  git -C "$REPO" commit -q -m "add session-sync.sh + fake setup.sh"
  git -C "$REPO" push -q origin main
}

teardown() {
  destroy_sandbox
}

run_sync() {
  run bash "$REPO/scripts/session-sync.sh"
}

# A `git` shim that fails only `git status --porcelain` (simulating a
# corrupted repo or a permissions error) and passes every other invocation
# through to the real binary. Fires ONLY ONCE (a marker file tracks that) so
# it isolates the script's pre-fetch status check from its post-fetch
# recheck — failing both would let either one's message satisfy an
# assertion meant to pin down just one of them.
make_failing_git_status_shim() {
  fired_marker="$SANDBOX/git-status-shim-fired"
  rm -f "$fired_marker"
  cat > "$SHIM_BIN/git" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "status" ] && [ "\$2" = "--porcelain" ] && [ ! -e "$fired_marker" ]; then
  : > "$fired_marker"
  exit 1
fi
exec "$REAL_GIT" "\$@"
EOF
  chmod +x "$SHIM_BIN/git"
}

# A `git` shim that fails only `git fetch` (simulating a network failure).
# session-sync.sh's actual fetch call is `git -c ... -c ... fetch --quiet
# origin main`, so "fetch" isn't $1 — it has to be found anywhere in the
# argument list, not just checked positionally.
make_failing_git_fetch_shim() {
  cat > "$SHIM_BIN/git" <<EOF
#!/usr/bin/env bash
case " \$* " in
  *" fetch "*)
    echo "fake git: fetch failed" >&2
    exit 1
    ;;
esac
exec "$REAL_GIT" "\$@"
EOF
  chmod +x "$SHIM_BIN/git"
}

# A `git` shim that performs a real fetch, then checks out a DIFFERENT
# branch in $REPO as a side effect — reproducing the race the
# recheck-after-fetch guard exists to catch: something else changing the
# checkout during the one slow, network-bound step.
# Usage: make_checkout_mutating_fetch_shim <branch>
make_checkout_mutating_fetch_shim() {
  branch="$1"
  git -C "$REPO" branch -q "$branch" main
  cat > "$SHIM_BIN/git" <<EOF
#!/usr/bin/env bash
case " \$* " in
  *" fetch "*)
    "$REAL_GIT" "\$@"
    "$REAL_GIT" -C "$REPO" checkout -q "$branch"
    exit 0
    ;;
esac
exec "$REAL_GIT" "\$@"
EOF
  chmod +x "$SHIM_BIN/git"
}

@test "skips and does not run setup.sh when the tree has uncommitted changes" {
  echo "dirty" > "$REPO/dirty.txt"
  run_sync
  assert_success
  assert_output_contains "working tree has uncommitted changes"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "skips when not on branch main" {
  git -C "$REPO" checkout -q -b other
  run_sync
  assert_success
  assert_output_contains "not main"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "fast-forwards to origin/main and runs setup.sh when behind" {
  git -C "$REPO" commit -q --allow-empty -m "second commit"
  git -C "$REPO" push -q origin main
  remote_sha="$(git -C "$REPO" rev-parse origin/main)"
  git -C "$REPO" reset --hard -q HEAD~1

  run_sync
  assert_success
  assert_output_contains "Fast-forwarded"
  assert_output_contains "fake setup.sh ran"
  [ "$(git -C "$REPO" rev-parse HEAD)" = "$remote_sha" ]
  [ -e "$FAKE_SETUP_MARKER" ]
}

@test "reports already up to date and still runs setup.sh" {
  run_sync
  assert_success
  assert_output_contains "Already up to date"
  [ -e "$FAKE_SETUP_MARKER" ]
}

@test "skips without merging when local main has diverged (unpushed commit)" {
  git -C "$REPO" commit -q --allow-empty -m "local only, unpushed"
  local_sha_before="$(git -C "$REPO" rev-parse HEAD)"

  run_sync
  assert_success
  assert_output_contains "not a fast-forward"
  [ "$(git -C "$REPO" rev-parse HEAD)" = "$local_sha_before" ]
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "fails closed when the pre-fetch git status check fails" {
  make_failing_git_status_shim
  run_sync
  assert_success
  assert_output_contains "Skipping: git status failed"
  # Distinct from the post-fetch recheck's message below — pins this failure
  # to the FIRST check, not just "some check caught it somehow".
  refute_output_contains "after fetch"
  refute_output_contains "Fast-forwarded"
  refute_output_contains "Already up to date"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "skips when the checkout changes during fetch (TOCTOU recheck)" {
  make_checkout_mutating_fetch_shim other-branch
  run_sync
  assert_success
  assert_output_contains "checkout changed during fetch"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "skips when git fetch fails" {
  make_failing_git_fetch_shim
  run_sync
  assert_success
  assert_output_contains "git fetch failed"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "reports a missing git dependency" {
  # A PATH with bash but no git: session-sync.sh's own `command -v git`
  # check must find nothing. A bare empty dir would also strip `bash`
  # itself off PATH, so bats' `run` can't even exec the script (exit 127,
  # "command not found") — symlink in just bash, not the rest of the
  # sandbox's real PATH.
  NO_GIT_BIN="$SANDBOX/no-git-bin"
  mkdir -p "$NO_GIT_BIN"
  ln -s "$(command -v bash)" "$NO_GIT_BIN/bash"
  PATH="$NO_GIT_BIN" run bash "$REPO/scripts/session-sync.sh"
  assert_status 4
  assert_output_contains "git not found on PATH"
}

@test "--help prints usage and touches nothing" {
  run bash "$REPO/scripts/session-sync.sh" --help
  assert_success
  assert_output_contains "Usage: ./scripts/session-sync.sh"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}

@test "an unknown argument exits 2 and touches nothing" {
  run bash "$REPO/scripts/session-sync.sh" --nope
  assert_status 2
  assert_output_contains "Unknown argument: --nope"
  [ ! -e "$FAKE_SETUP_MARKER" ]
}
