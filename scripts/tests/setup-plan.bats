#!/usr/bin/env bats
# Tests for the decision half of setup.sh: scripts/setup-plan-lib.sh, exercised
# through `setup.sh --plan`. The plan is plain data (one TAB-separated action
# per line, format documented in the library), so each test states the inputs
# (a fixture repo, a HOME in some state, --skip/--include flags) and asserts the
# exact plan lines. Nothing here applies a plan except where a test first runs
# the real setup to reach an "already installed" state.
#
# Hermetic like every suite here: HOME is redirected into the sandbox and the
# network-blocking shims are on PATH (see helpers.bash).

load helpers

T=$'\t'

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts" "$FAKE_REPO/claude/commands" "$FAKE_REPO/claude/conventions"
  cp "$REPO_ROOT/setup.sh" "$FAKE_REPO/"
  chmod +x "$FAKE_REPO/setup.sh"
  local lib
  for lib in claude-md-lib.sh settings-lib.sh plugin-hooks.sh symlink-lib.sh \
    setup-plan-lib.sh offer-safe-chain-permission.sh git-identity.sh check-companions.sh; do
    cp "$REPO_ROOT/scripts/$lib" "$FAKE_REPO/scripts/$lib"
  done
  echo "# global instructions" >"$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" >"$FAKE_REPO/claude/commands/demo.md"
  echo "# another command" >"$FAKE_REPO/claude/commands/other.md"
  echo "## Convention one" >"$FAKE_REPO/claude/conventions/one.md"
  printf '# comment\n\none.md\n' >"$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  local p
  for p in dfadler-agent-config worktree-core; do
    mkdir -p "$FAKE_REPO/plugins/$p/.claude-plugin"
    printf '{"name":"%s"}\n' "$p" >"$FAKE_REPO/plugins/$p/.claude-plugin/plugin.json"
  done
  CLAUDE="$HOME/.claude"
  WT_HOOKS="$CLAUDE/skills/worktree-core/skills/git-worktree-usage/scripts"
  MH_HOOK="$CLAUDE/skills/dfadler-agent-config/hooks/scripts/memory-hygiene-stop-hook.sh"
}

teardown() {
  destroy_sandbox
}

# Assertions on $output. Written as functions with an explicit return rather
# than bare [[ ]]: a failing [[ ]] in the middle of a test does not abort it on
# every bash bats can run under, so it would pass vacuously.
has() {
  [[ "$output" == *"$1"* ]] || {
    echo "expected plan to contain: $1" >&2
    echo "plan was:" >&2
    echo "$output" >&2
    return 1
  }
}

lacks() {
  [[ "$output" != *"$1"* ]] || {
    echo "expected plan NOT to contain: $1" >&2
    echo "plan was:" >&2
    echo "$output" >&2
    return 1
  }
}

# Run the plan (no writes) with extra flags; sets $output/$status.
plan() {
  run bash "$FAKE_REPO/setup.sh" --plan "$@"
}

# Run the real setup to reach an installed state.
install() {
  run bash "$FAKE_REPO/setup.sh" --no-companions "$@"
  [ "$status" -eq 0 ]
}

# The plan lines for the hook rows, in plugin-hooks.sh order.
hook_lines() {
  printf 'register-hook\tPreToolUse\t%s\tEdit|Write\n' "$WT_HOOKS/require-worktree-hook.sh"
  printf 'register-hook\tSessionStart\t%s\n' "$WT_HOOKS/check-worktree-symlinks-hook.sh"
  printf 'register-hook\tSessionStart\t%s\n' "$WT_HOOKS/prune-merged-worktrees-hook.sh"
  printf 'register-hook\tStop\t%s\n' "$MH_HOOK"
}

@test "plan: clean HOME yields the full install plan, in apply order" {
  plan
  [ "$status" -eq 0 ]
  expected="$(
    printf 'mkdir\t%s\n' "$CLAUDE"
    printf 'personal-create\t%s\n' "$CLAUDE/CLAUDE.personal.md"
    printf 'include\tCLAUDE.personal.md\n'
    printf 'include\t%s\n' "$FAKE_REPO/claude/CLAUDE.md"
    printf 'include\t%s\n' "$FAKE_REPO/claude/conventions/one.md"
    printf 'claude-md\tcreate\t%s\n' "$CLAUDE/CLAUDE.md"
    printf 'mkdir\t%s\n' "$CLAUDE/commands"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/claude/commands/demo.md" "$CLAUDE/commands/demo.md"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/claude/commands/other.md" "$CLAUDE/commands/other.md"
    printf 'mkdir\t%s\n' "$CLAUDE/skills"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/dfadler-agent-config" "$CLAUDE/skills/dfadler-agent-config"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/worktree-core" "$CLAUDE/skills/worktree-core"
    hook_lines
  )"
  [ "$output" = "$expected" ]
}

@test "plan: --dry-run is an alias and writes nothing under HOME" {
  run bash "$FAKE_REPO/setup.sh" --dry-run
  [ "$status" -eq 0 ]
  has "claude-md${T}create${T}"
  [ -z "$(ls -A "$HOME")" ]
}

@test "plan: --plan does not run companion checks or print the re-run footer" {
  plan --skip=demo
  [ "$status" -eq 0 ]
  lacks "To re-run"
}

@test "plan: help documents --plan and --dry-run" {
  run bash "$FAKE_REPO/setup.sh" --help
  [ "$status" -eq 0 ]
  has "--plan, --dry-run"
}

@test "plan: already-installed state yields an empty plan" {
  install
  plan
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "plan: already-installed state with --skip also yields an empty plan except informational skips" {
  install --skip=demo,worktree-core
  plan --skip=demo,worktree-core
  [ "$status" -eq 0 ]
  expected="$(
    printf 'skip-plugin\tworktree-core\t--skip\n'
    printf 'skip-command\t%s\t--skip\tdemo\n' "$CLAUDE/commands/demo.md"
  )"
  [ "$output" = "$expected" ]
}

@test "plan: --skip leaves a command and a plugin out and reports why" {
  plan --skip=demo,worktree-core
  [ "$status" -eq 0 ]
  has "skip-plugin${T}worktree-core${T}--skip"
  has "skip-command${T}$CLAUDE/commands/demo.md${T}--skip${T}demo"
  lacks "link${T}$FAKE_REPO/claude/commands/demo.md"
  lacks "link${T}$FAKE_REPO/plugins/worktree-core"
  has "link${T}$FAKE_REPO/claude/commands/other.md"
  has "link${T}$FAKE_REPO/plugins/dfadler-agent-config"
  # Hooks of the skipped plugin are not registered; the other plugin's are.
  lacks "register-hook${T}PreToolUse"
  has "register-hook${T}Stop${T}$MH_HOOK"
}

@test "plan: --include keeps only what it names and says 'not in --include'" {
  plan --include=other,dfadler-agent-config
  [ "$status" -eq 0 ]
  has "skip-plugin${T}worktree-core${T}not in --include"
  has "skip-command${T}$CLAUDE/commands/demo.md${T}not in --include${T}demo"
  has "link${T}$FAKE_REPO/claude/commands/other.md"
  has "link${T}$FAKE_REPO/plugins/dfadler-agent-config"
  lacks "link${T}$FAKE_REPO/claude/commands/demo.md"
  lacks "link${T}$FAKE_REPO/plugins/worktree-core"
}

@test "plan: --include and --skip selections are the complement of each other" {
  plan --skip=demo,worktree-core
  skip_plan="$output"
  plan --include=other,dfadler-agent-config
  # Same actions; only the wording of the informational reason differs.
  [ "${output//not in --include/--skip}" = "$skip_plan" ]
}

@test "plan: opting a feature out after install plans its unlink and hook deregistration" {
  install
  plan --skip=demo,worktree-core
  [ "$status" -eq 0 ]
  has "unlink${T}opted-out${T}$CLAUDE/commands/demo.md${T}$FAKE_REPO/claude/commands/demo.md"
  has "unlink${T}superseded${T}$CLAUDE/skills/worktree-core${T}$FAKE_REPO/plugins/worktree-core"
  has "deregister-hook${T}PreToolUse${T}$WT_HOOKS/require-worktree-hook.sh"
  has "deregister-hook${T}SessionStart${T}$WT_HOOKS/check-worktree-symlinks-hook.sh"
  has "deregister-hook${T}SessionStart${T}$WT_HOOKS/prune-merged-worktrees-hook.sh"
  # The kept plugin's hook is already registered: no action for it.
  lacks "Stop"
}

@test "plan: a hook that is already registered is not planned again" {
  install
  rm "$CLAUDE/skills/dfadler-agent-config"
  python3 - "$CLAUDE/settings.json" "$MH_HOOK" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data["hooks"]["Stop"] = []
json.dump(data, open(path, "w"))
PY
  plan
  [ "$status" -eq 0 ]
  has "register-hook${T}Stop${T}$MH_HOOK"
  lacks "register-hook${T}PreToolUse"
  has "link${T}$FAKE_REPO/plugins/dfadler-agent-config${T}$CLAUDE/skills/dfadler-agent-config"
}

@test "plan: a stale symlink this repo owns is replaced; a foreign or real one is only warned about" {
  mkdir -p "$CLAUDE/commands" "$SANDBOX/elsewhere"
  ln -s "$FAKE_REPO/claude/commands/gone.md" "$CLAUDE/commands/demo.md"
  ln -s "$SANDBOX/elsewhere" "$CLAUDE/commands/other.md"
  plan
  [ "$status" -eq 0 ]
  has "relink${T}$FAKE_REPO/claude/commands/demo.md${T}$CLAUDE/commands/demo.md${T}$FAKE_REPO/claude/commands/gone.md"
  has "warn-foreign-symlink${T}$CLAUDE/commands/other.md${T}$SANDBOX/elsewhere"
  rm "$CLAUDE/commands/other.md"
  echo "mine" >"$CLAUDE/commands/other.md"
  plan
  has "warn-exists${T}$CLAUDE/commands/other.md"
}

@test "plan: a superseded plugin link is unlinked and then linked fresh, not 'relinked'" {
  mkdir -p "$CLAUDE/skills"
  ln -s "$FAKE_REPO/plugins/worktree-core" "$CLAUDE/skills/dfadler-agent-config"
  plan
  [ "$status" -eq 0 ]
  has "unlink${T}superseded${T}$CLAUDE/skills/dfadler-agent-config${T}$FAKE_REPO/plugins/worktree-core"
  has "link${T}$FAKE_REPO/plugins/dfadler-agent-config${T}$CLAUDE/skills/dfadler-agent-config"
  lacks "relink"
}

@test "plan: a leftover per-skill link into plugins/ under agents/ is unlinked" {
  mkdir -p "$CLAUDE/agents"
  ln -s "$FAKE_REPO/plugins/worktree-core/agents/old.md" "$CLAUDE/agents/old.md"
  plan
  has "unlink${T}superseded${T}$CLAUDE/agents/old.md${T}$FAKE_REPO/plugins/worktree-core/agents/old.md"
}

@test "plan: an existing hand-written CLAUDE.md is migrated aside, then the section is created" {
  mkdir -p "$CLAUDE"
  echo "my own notes" >"$CLAUDE/CLAUDE.md"
  plan
  [ "$status" -eq 0 ]
  has "personal-migrate${T}$CLAUDE/CLAUDE.md${T}$CLAUDE/CLAUDE.personal.md"
  has "claude-md${T}create${T}$CLAUDE/CLAUDE.md"
  lacks "personal-create"
}

@test "plan: claude-md mode follows the state of the generated file" {
  mkdir -p "$CLAUDE"
  : >"$CLAUDE/CLAUDE.personal.md"
  # Legacy symlink to the repo.
  ln -s "$FAKE_REPO/claude/CLAUDE.md" "$CLAUDE/CLAUDE.md"
  plan
  has "claude-md${T}replace-symlink${T}$CLAUDE/CLAUDE.md"
  rm "$CLAUDE/CLAUDE.md"
  # A real file without our section.
  echo "user content" >"$CLAUDE/CLAUDE.md"
  plan
  has "claude-md${T}prepend${T}$CLAUDE/CLAUDE.md"
  # A section whose body is stale.
  printf '%s\n@/old/location/CLAUDE.md\n%s\n' \
    "# >>> agent-config managed begin <<<" "# >>> agent-config managed end <<<" >"$CLAUDE/CLAUDE.md"
  plan
  has "claude-md${T}update${T}$CLAUDE/CLAUDE.md"
}

@test "plan: a changed DEFAULT_ENABLED shows up as an update with the new include" {
  install
  printf 'one.md\n' >"$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  echo "## Two" >"$FAKE_REPO/claude/conventions/two.md"
  printf 'one.md\ntwo.md\n' >"$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  plan
  [ "$status" -eq 0 ]
  expected="$(
    printf 'include\tCLAUDE.personal.md\n'
    printf 'include\t%s\n' "$FAKE_REPO/claude/CLAUDE.md"
    printf 'include\t%s\n' "$FAKE_REPO/claude/conventions/one.md"
    printf 'include\t%s\n' "$FAKE_REPO/claude/conventions/two.md"
    printf 'claude-md\tupdate\t%s\n' "$CLAUDE/CLAUDE.md"
  )"
  [ "$output" = "$expected" ]
}

@test "plan: planning twice is identical and leaves HOME untouched (pure)" {
  install
  rm "$CLAUDE/commands/demo.md"
  plan
  first="$output"
  plan
  [ "$output" = "$first" ]
  [ ! -e "$CLAUDE/commands/demo.md" ]
}

@test "plan: every plan line starts with a verb from the documented set" {
  mkdir -p "$CLAUDE/commands" "$CLAUDE/skills" "$SANDBOX/elsewhere"
  ln -s "$SANDBOX/elsewhere" "$CLAUDE/commands/other.md"
  plan --skip=demo
  [ "$status" -eq 0 ]
  local line verb
  while IFS= read -r line; do
    verb="${line%%$'\t'*}"
    case "$verb" in
      mkdir | personal-migrate | personal-create | include | claude-md | link | relink | unlink | \
        register-hook | deregister-hook | skip-plugin | skip-command | warn-foreign-symlink | warn-exists) ;;
      *)
        echo "undocumented verb: $verb" >&2
        return 1
        ;;
    esac
  done <<<"$output"
}

@test "plan: applying the plan yields the same tree as the plan describes (round trip)" {
  plan
  planned_links="$(grep -c '^link' <<<"$output")"
  install
  [ "$(find "$CLAUDE/commands" "$CLAUDE/skills" -type l | wc -l | tr -d ' ')" -eq "$planned_links" ]
}

@test "hook_registration_state: 0 registered, 1 not registered or no file, 2 unreadable" {
  settings="$SANDBOX/settings.json"
  run bash -c 'source "$1"; hook_registration_state E /x "$2"' _ "$REPO_ROOT/scripts/settings-lib.sh" "$settings"
  [ "$status" -eq 1 ]
  echo '{"hooks":{"E":[{"hooks":[{"type":"command","command":"/x"}]}]}}' >"$settings"
  run bash -c 'source "$1"; hook_registration_state E /x "$2"' _ "$REPO_ROOT/scripts/settings-lib.sh" "$settings"
  [ "$status" -eq 0 ]
  run bash -c 'source "$1"; hook_registration_state E /other "$2"' _ "$REPO_ROOT/scripts/settings-lib.sh" "$settings"
  [ "$status" -eq 1 ]
  echo 'not json' >"$settings"
  run bash -c 'source "$1"; hook_registration_state E /x "$2"' _ "$REPO_ROOT/scripts/settings-lib.sh" "$settings"
  [ "$status" -eq 2 ]
}

@test "hook_registration_state: never writes to the settings file" {
  settings="$SANDBOX/settings.json"
  echo '{"hooks":{}}' >"$settings"
  before="$(shasum "$settings")"
  run bash -c 'source "$1"; hook_registration_state E /x "$2"' _ "$REPO_ROOT/scripts/settings-lib.sh" "$settings"
  [ "$(shasum "$settings")" = "$before" ]
}
