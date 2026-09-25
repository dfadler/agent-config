#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/
# verify-worktree-symlinks.sh — detects (and with --fix, repairs) a
# worktree's symlinked directory pointing somewhere other than the main
# checkout. Covers the failure mode described in the script's own header: a
# worktree's symlink resolving to a DIFFERENT worktree's copy instead of the
# main checkout's.
#
# Hermetic: real git against the sandbox repo from helpers.bash, real jq
# (read-only JSON parsing, no network).

load helpers

SCRIPT_UNDER_TEST="$REPO_ROOT/plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/verify-worktree-symlinks.sh"

setup() {
  make_git_sandbox
  mkdir -p "$REPO/.claude"
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": ["node_modules"] }
}
EOF
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m "add settings"
  # node_modules is deliberately left UNTRACKED (as it would be in a real repo,
  # via .gitignore) so `git worktree add` never checks it out into a new
  # worktree — only the main checkout has it, which is exactly the setup this
  # script is meant to verify against.
  mkdir -p "$REPO/node_modules"
  echo "main-nm-marker" >"$REPO/node_modules/marker.txt"
}

teardown() {
  destroy_sandbox
}

# Create a linked worktree under .claude/worktrees/<name>; print its path.
_add_wt() {
  local name="$1"
  # Separate `local` statements: combining these into one (`local name="$1"
  # path="...$name"`) is a classic bash pitfall — the whole simple command's
  # words are expanded before any assignment takes effect, so the second
  # assignment would see the OLD (unset) $name, not the just-declared one.
  local path="$REPO/.claude/worktrees/$name"
  git -C "$REPO" worktree add -q -b "worktree-$name" "$path" main >/dev/null
  printf '%s' "$path"
}

# run_verify <cwd> [args...] — run the real script from <cwd>.
run_verify() {
  local cwd="$1"
  shift
  run bash -c 'cd -- "$1" && bash "$2" "${@:3}"' bash "$cwd" "$SCRIPT_UNDER_TEST" "$@"
}

@test "a symlink correctly pointing at the main checkout passes" {
  wt="$(_add_wt alpha)"
  ln -s "$REPO/node_modules" "$wt/node_modules"

  run_verify "$wt"
  assert_success
  [ -z "$output" ]
}

@test "a symlink pointing at a DIFFERENT worktree's node_modules is caught" {
  wt="$(_add_wt beta)"
  other="$(_add_wt other)"
  mkdir "$other/node_modules"
  echo "other-nm-marker" >"$other/node_modules/marker.txt"
  ln -s "$other/node_modules" "$wt/node_modules"

  run_verify "$wt"
  assert_failure
  assert_output_contains "not the main checkout"
  # Check-only mode never touches the filesystem.
  [ "$(cat "$wt/node_modules/marker.txt")" = "other-nm-marker" ]
}

@test "--fix relinks a mismatched symlink to the main checkout" {
  wt="$(_add_wt gamma)"
  other="$(_add_wt other)"
  mkdir "$other/node_modules"
  echo "other-nm-marker" >"$other/node_modules/marker.txt"
  ln -s "$other/node_modules" "$wt/node_modules"

  run_verify "$wt" --fix
  assert_success
  assert_output_contains "relinked node_modules"
  [ -L "$wt/node_modules" ]
  [ "$(cat "$wt/node_modules/marker.txt")" = "main-nm-marker" ]

  # Re-running now reports clean.
  run_verify "$wt"
  assert_success
  [ -z "$output" ]
}

@test "a broken symlink is caught, and --fix repairs it" {
  wt="$(_add_wt delta)"
  ln -s "$REPO/does-not-exist" "$wt/node_modules"

  run_verify "$wt"
  assert_failure
  assert_output_contains "broken symlink"

  run_verify "$wt" --fix
  assert_success
  [ "$(cat "$wt/node_modules/marker.txt")" = "main-nm-marker" ]
}

@test "a failed relink (rm or ln -s fails) is reported as unresolved, not silently OK" {
  wt="$(_add_wt iota)"
  ln -s "$REPO/does-not-exist" "$wt/node_modules"
  # Removing an entry needs write permission on its PARENT directory, so
  # locking down the worktree dir itself makes the fix path's `rm` fail —
  # without touching filesystem state in a way a real failure wouldn't.
  chmod 555 "$wt"

  run_verify "$wt" --fix
  local status="$status"
  chmod 755 "$wt" # restore before teardown's rm -rf, or cleanup fails partway
  [ "$status" -ne 0 ]
  assert_output_contains "failed to relink"
  # Never claims success on a fix that didn't actually happen.
  [[ "$output" != *"relinked node_modules"* ]]
}

@test "a materialized real directory (not a symlink) is left untouched" {
  wt="$(_add_wt epsilon)"
  mkdir "$wt/node_modules"
  echo "materialized-marker" >"$wt/node_modules/marker.txt"

  run_verify "$wt" --fix
  assert_success
  [ -z "$output" ]
  [ ! -L "$wt/node_modules" ]
  [ "$(cat "$wt/node_modules/marker.txt")" = "materialized-marker" ]
}

@test "a missing node_modules is a silent no-op" {
  wt="$(_add_wt zeta)"
  [ ! -e "$wt/node_modules" ]

  run_verify "$wt" --fix
  assert_success
  [ -z "$output" ]
  [ ! -e "$wt/node_modules" ]
}

@test "the main checkout itself is a no-op" {
  run_verify "$REPO" --fix
  assert_success
  [ -z "$output" ]
}

@test "a repo with no worktree.symlinkDirectories configured is a silent no-op" {
  cat >"$REPO/.claude/settings.json" <<'EOF'
{}
EOF
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "no symlinkDirectories"

  wt="$(_add_wt no-config)"
  ln -s "$REPO/node_modules" "$wt/node_modules"

  run_verify "$wt" --fix
  assert_success
  [ -z "$output" ]
}

@test "an earlier unfixable entry's failure survives a later entry's successful --fix" {
  # Regression for a scalar `status` shared across loop iterations: fixing a
  # LATER symlinkDirectories entry must not erase an EARLIER entry's still-
  # unresolved failure. Order matters — "vendor" (unfixable: main checkout
  # has no such directory) is listed before "node_modules" (fixable).
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": ["vendor", "node_modules"] }
}
EOF
  # Add only settings.json, not -A — node_modules is deliberately untracked
  # (see setup()) so a new worktree never gets it checked out.
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "add a second, unfixable symlinkDirectories entry"

  wt="$(_add_wt theta)"
  other="$(_add_wt other)"
  mkdir "$other/node_modules"
  echo "other-nm-marker" >"$other/node_modules/marker.txt"

  # "vendor" is a symlink here, but main has no vendor directory to point at.
  ln -s "$REPO/node_modules" "$wt/vendor"
  # "node_modules" is fixably wrong (points at a sibling worktree).
  ln -s "$other/node_modules" "$wt/node_modules"

  run_verify "$wt" --fix
  assert_failure
  assert_output_contains "vendor"
  assert_output_contains "relinked node_modules"
  # node_modules WAS repaired (best-effort, per-entry) ...
  [ "$(cat "$wt/node_modules/marker.txt")" = "main-nm-marker" ]
  # ... but the overall exit code still reflects vendor's unresolved failure.
}

# --- config validation (EXIT_CONFIG) -----------------------------------------

@test "malformed settings.json JSON exits 3 (EXIT_CONFIG) instead of silently reading as empty" {
  printf '{ "worktree": { "symlinkDirectories": [,] } }' >"$REPO/.claude/settings.json"
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "malformed settings.json"

  wt="$(_add_wt bad-json)"
  ln -s "$REPO/node_modules" "$wt/node_modules"

  run_verify "$wt" --fix
  [ "$status" -eq 3 ]
  assert_output_contains "could not read worktree.symlinkDirectories"
  # Must not silently treat the malformed config as "nothing configured" and
  # proceed to touch the symlink anyway.
  [ "$(readlink "$wt/node_modules")" = "$REPO/node_modules" ]
}

@test "a non-array worktree.symlinkDirectories exits 3 (EXIT_CONFIG), not silently empty" {
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": { "node_modules": "yes please" } }
}
EOF
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "object instead of array"

  wt="$(_add_wt object-config)"

  run_verify "$wt" --fix
  [ "$status" -eq 3 ]
  assert_output_contains "must be an array, got object"
}

@test "a null worktree.symlinkDirectories is a clean no-op, not a config error" {
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": null }
}
EOF
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "explicit null"

  wt="$(_add_wt null-config)"

  run_verify "$wt" --fix
  assert_success
  [ -z "$output" ]
}

# --- path-traversal guard -----------------------------------------------------

@test "a symlinkDirectories entry containing '..' is rejected, never touched" {
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": ["../../etc"] }
}
EOF
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "traversal entry"

  wt="$(_add_wt traversal)"
  # A real symlink at the traversal target, so a bug that DID follow it would
  # be observable (relinked) rather than silently missing.
  mkdir -p "$SANDBOX/outside-marker"
  ln -s "$SANDBOX/outside-marker" "$SANDBOX/etc"

  run_verify "$wt" --fix
  assert_failure
  assert_output_contains "contains a '..' segment"
  # Nothing outside the worktree was touched.
  [ "$(readlink "$SANDBOX/etc")" = "$SANDBOX/outside-marker" ]
}

@test "an absolute symlinkDirectories entry is rejected, never touched" {
  cat >"$REPO/.claude/settings.json" <<'EOF'
{
  "worktree": { "symlinkDirectories": ["/etc"] }
}
EOF
  git -C "$REPO" add .claude/settings.json
  git -C "$REPO" commit -q -m "absolute entry"

  wt="$(_add_wt absolute)"

  run_verify "$wt" --fix
  assert_failure
  assert_output_contains "is an absolute path"
}

@test "--help prints usage and touches nothing" {
  wt="$(_add_wt eta)"
  other="$(_add_wt other)"
  mkdir "$other/node_modules"
  ln -s "$other/node_modules" "$wt/node_modules"

  run_verify "$wt" --help
  assert_success
  assert_output_contains "verify-worktree-symlinks.sh"
  # Still pointing at "other" — --help must not have touched the symlink.
  [ "$(readlink "$wt/node_modules")" = "$other/node_modules" ]
}

# --- dependency / environment guards -----------------------------------------

@test "running outside any git repository exits 2" {
  # GIT_CEILING_DIRECTORIES is pinned to $SANDBOX by helpers.bash, and
  # $SANDBOX itself carries no .git of its own (only $REPO, one level down,
  # does) — so a plain subdirectory of $SANDBOX genuinely has no git repo to
  # find, real absence rather than a shimmed one.
  mkdir -p "$SANDBOX/not-a-repo"
  run_verify "$SANDBOX/not-a-repo"
  [ "$status" -eq 2 ]
  [[ "$output" == *"Not inside a git repository"* ]]
}

@test "jq missing on PATH is a silent no-op for a project with no .claude/settings.json at all" {
  # A project that never adopted the symlinkDirectories convention (no
  # settings.json in this worktree) must not be forced to install jq just to
  # reach the no-op — jq is only required once there's a settings.json to
  # actually parse.
  git -C "$REPO" rm -q .claude/settings.json
  git -C "$REPO" commit -q -m "remove settings.json"

  wt="$(_add_wt no-jq-no-settings)"
  [ ! -f "$wt/.claude/settings.json" ]
  mini_bin="$SANDBOX/no-jq-bin"
  mkdir -p "$mini_bin"
  local tool
  for tool in bash git dirname; do
    ln -s "$(command -v "$tool")" "$mini_bin/$tool"
  done

  run bash -c 'cd -- "$1" && PATH="$2" bash "$3" --fix' bash "$wt" "$mini_bin" "$SCRIPT_UNDER_TEST"
  assert_success
  [ -z "$output" ]
}

@test "jq missing on PATH exits 4 (EXIT_DEPENDENCY)" {
  # A minimal PATH holding only bash and git (both needed before the script
  # ever reaches its own `command -v jq` check) — deliberately omitting jq,
  # so the dependency check trips against a real absence.
  wt="$(_add_wt alpha)"
  mini_bin="$SANDBOX/no-jq-bin"
  mkdir -p "$mini_bin"
  local tool
  for tool in bash git; do
    ln -s "$(command -v "$tool")" "$mini_bin/$tool"
  done

  run bash -c 'cd -- "$1" && PATH="$2" bash "$3"' bash "$wt" "$mini_bin" "$SCRIPT_UNDER_TEST"
  [ "$status" -eq 4 ]
  [[ "$output" == *"jq is required"* ]]
}
