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
  for lib in claude-md-lib.sh settings-lib.sh plugin-hooks.sh plugin-hooks.tsv symlink-lib.sh \
    setup-plan-lib.sh offer-safe-chain-permission.sh git-identity.sh check-companions.sh; do
    cp "$REPO_ROOT/scripts/$lib" "$FAKE_REPO/scripts/$lib"
  done
  echo "# global instructions" >"$FAKE_REPO/claude/CLAUDE.md"
  echo "# a command" >"$FAKE_REPO/claude/commands/demo.md"
  echo "# another command" >"$FAKE_REPO/claude/commands/other.md"
  echo "## Convention one" >"$FAKE_REPO/claude/conventions/one.md"
  echo "## Convention two (opt-in only)" >"$FAKE_REPO/claude/conventions/two.md"
  printf '# comment\n\none.md\n' >"$FAKE_REPO/claude/conventions/DEFAULT_ENABLED"
  local p
  for p in collab-retro gh-publish-guide memory-hygiene scratch-guard worktree-core; do
    mkdir -p "$FAKE_REPO/plugins/$p/.claude-plugin"
    printf '{"name":"%s"}\n' "$p" >"$FAKE_REPO/plugins/$p/.claude-plugin/plugin.json"
  done
  CLAUDE="$HOME/.claude"
  WT_HOOKS="$CLAUDE/skills/worktree-core/scripts/ts"
  MH_HOOK="node${T}[\"$CLAUDE/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\"]"
  MH_SHELL="node \"$CLAUDE/skills/memory-hygiene/scripts/ts/memory-hygiene-stop-hook.ts\""
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
  printf 'register-hook\tPreToolUse\tnode\t["%s"]\tEdit|Write\n' "$WT_HOOKS/require-worktree-hook.ts"
  printf 'register-hook\tSessionStart\tnode\t["%s"]\n' "$WT_HOOKS/check-worktree-symlinks-hook.ts"
  printf 'register-hook\tSessionStart\tnode\t["%s"]\n' "$WT_HOOKS/prune-merged-worktrees-hook.ts"
  printf 'register-hook\tPreToolUse\tnode\t["%s"]\tBash\n' "$WT_HOOKS/commit-branch-guard-hook.ts"
  printf 'register-hook\tStop\t%s\n' "$MH_HOOK"
  printf 'register-hook\tPreToolUse\tnode\t["%s"]\tEdit|Write\n' "$CLAUDE/skills/scratch-guard/scripts/ts/scratch-guard-hook.ts"
  printf 'register-hook\tSessionStart\tnode\t["%s"]\n' "$CLAUDE/skills/collab-retro/scripts/ts/offer-incident-retro-hook.ts"
  printf 'register-hook\tUserPromptSubmit\tnode\t["%s"]\n' "$CLAUDE/skills/collab-retro/scripts/ts/incident-nudge-hook.ts"
  printf 'register-hook\tStop\tnode\t["%s"]\n' "$CLAUDE/skills/collab-retro/scripts/ts/incident-nudge-hook.ts"
  printf 'register-hook\tPreToolUse\tnode\t["%s"]\tBash\n' "$CLAUDE/skills/gh-publish-guide/scripts/ts/protected-remote-hook.ts"
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
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/collab-retro" "$CLAUDE/skills/collab-retro"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/gh-publish-guide" "$CLAUDE/skills/gh-publish-guide"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/memory-hygiene" "$CLAUDE/skills/memory-hygiene"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/scratch-guard" "$CLAUDE/skills/scratch-guard"
    printf 'link\t%s\t%s\n' "$FAKE_REPO/plugins/worktree-core" "$CLAUDE/skills/worktree-core"
    hook_lines
    printf 'default-setting\t%s\tworktree.autoPrune\ttrue\n' "$CLAUDE/settings.json"
  )"
  [ "$output" = "$expected" ]
}

@test "plan: worktree.autoPrune is seeded to true when absent" {
  plan
  [ "$status" -eq 0 ]
  has "default-setting${T}$CLAUDE/settings.json${T}worktree.autoPrune${T}true"
}

@test "plan: a user's worktree.autoPrune value is never planned over" {
  mkdir -p "$CLAUDE"
  printf '{"worktree":{"autoPrune":false}}\n' >"$CLAUDE/settings.json"
  plan
  [ "$status" -eq 0 ]
  lacks "default-setting"
}

@test "plan: --skip=worktree-core leaves worktree.autoPrune alone" {
  plan --skip=worktree-core
  [ "$status" -eq 0 ]
  lacks "default-setting"
}

# The opt-in pre-commit hook (scripts/hooks/pre-commit) is wired by pointing
# core.hooksPath at it; the fixtures above have no .git, so they stay inert.
git_hooks_fixture() {
  git -C "$FAKE_REPO" init -q
  mkdir -p "$FAKE_REPO/scripts/hooks"
  : >"$FAKE_REPO/scripts/hooks/pre-commit"
}

@test "plan: git-hooks-path is planned for a git checkout with the pre-commit hook" {
  git_hooks_fixture
  plan
  [ "$status" -eq 0 ]
  has "git-hooks-path${T}$FAKE_REPO${T}scripts/hooks"
  [ "$(grep -c '^git-hooks-path' <<<"$output")" -eq 1 ]
}

@test "plan: git-hooks-path is not planned once core.hooksPath is scripts/hooks, including after a real install" {
  git_hooks_fixture
  install
  [ "$(git -C "$FAKE_REPO" config --get core.hooksPath)" = "scripts/hooks" ]
  plan
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "plan: git-hooks-path never overwrites a different core.hooksPath" {
  git_hooks_fixture
  git -C "$FAKE_REPO" config core.hooksPath .husky
  plan
  [ "$status" -eq 0 ]
  lacks "git-hooks-path"
}

@test "plan: an absolute core.hooksPath to this repo's scripts/hooks is rewritten to the relative form" {
  git_hooks_fixture
  git -C "$FAKE_REPO" config core.hooksPath "$FAKE_REPO/scripts/hooks"
  plan
  [ "$status" -eq 0 ]
  has_line "git-hooks-path${T}$FAKE_REPO${T}scripts/hooks"
  install
  [ "$(git -C "$FAKE_REPO" config --get core.hooksPath)" = "scripts/hooks" ]
}

@test "plan: an absolute core.hooksPath to another repo's hooks is left alone" {
  git_hooks_fixture
  mkdir -p "$SANDBOX/other/scripts/hooks"
  git -C "$FAKE_REPO" config core.hooksPath "$SANDBOX/other/scripts/hooks"
  plan
  [ "$status" -eq 0 ]
  lacks "git-hooks-path"
}

@test "plan: git-hooks-path is left out by --skip=pii-cleanup" {
  git_hooks_fixture
  mkdir -p "$FAKE_REPO/plugins/pii-cleanup/.claude-plugin"
  echo '{"name":"pii-cleanup"}' >"$FAKE_REPO/plugins/pii-cleanup/.claude-plugin/plugin.json"
  plan --skip=pii-cleanup
  [ "$status" -eq 0 ]
  lacks "git-hooks-path"
  plan --include=demo
  lacks "git-hooks-path"
}

@test "plan: no git-hooks-path without the hook file or outside a git checkout" {
  git -C "$FAKE_REPO" init -q
  plan
  lacks "git-hooks-path"
  rm -rf "$FAKE_REPO/.git"
  mkdir -p "$FAKE_REPO/scripts/hooks"
  : >"$FAKE_REPO/scripts/hooks/pre-commit"
  plan
  lacks "git-hooks-path"
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
  has "link${T}$FAKE_REPO/plugins/memory-hygiene"
  # Hooks of the skipped plugin are not registered; the other plugin's are.
  lacks "register-hook${T}PreToolUse${T}node${T}[\"$WT_HOOKS/require-worktree-hook.ts"
  has "register-hook${T}Stop${T}$MH_HOOK"
}

@test "plan: --include keeps only what it names and says 'not in --include'" {
  plan --include=other,memory-hygiene,scratch-guard
  [ "$status" -eq 0 ]
  has "skip-plugin${T}worktree-core${T}not in --include"
  has "skip-command${T}$CLAUDE/commands/demo.md${T}not in --include${T}demo"
  has "link${T}$FAKE_REPO/claude/commands/other.md"
  has "link${T}$FAKE_REPO/plugins/memory-hygiene"
  lacks "link${T}$FAKE_REPO/claude/commands/demo.md"
  lacks "link${T}$FAKE_REPO/plugins/worktree-core"
}

@test "plan: --include and --skip selections are the complement of each other" {
  plan --skip=demo,worktree-core,collab-retro
  skip_plan="$output"
  plan --include=other,memory-hygiene,scratch-guard,gh-publish-guide
  # Same actions; only the wording of the informational reason differs.
  [ "${output//not in --include/--skip}" = "$skip_plan" ]
}

@test "plan: opting a feature out after install plans its unlink and hook deregistration" {
  install
  plan --skip=demo,worktree-core
  [ "$status" -eq 0 ]
  has "unlink${T}opted-out${T}$CLAUDE/commands/demo.md${T}$FAKE_REPO/claude/commands/demo.md"
  has "unlink${T}superseded${T}$CLAUDE/skills/worktree-core${T}$FAKE_REPO/plugins/worktree-core"
  has "deregister-hook${T}PreToolUse${T}node${T}[\"$WT_HOOKS/require-worktree-hook.ts\"]"
  has "deregister-hook${T}SessionStart${T}node${T}[\"$WT_HOOKS/check-worktree-symlinks-hook.ts\"]"
  has "deregister-hook${T}SessionStart${T}node${T}[\"$WT_HOOKS/prune-merged-worktrees-hook.ts\"]"
  # The kept plugin's hook is already registered: no action for it.
  lacks "Stop"
}

@test "plan: a hook that is already registered is not planned again" {
  install
  rm "$CLAUDE/skills/memory-hygiene"
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
  lacks "register-hook${T}PreToolUse${T}node${T}[\"$WT_HOOKS/require-worktree-hook.ts"
  has "link${T}$FAKE_REPO/plugins/memory-hygiene${T}$CLAUDE/skills/memory-hygiene"
}

@test "plan: a shell-form hook entry is migrated to exec form, not registered again" {
  install
  python3 - "$CLAUDE/settings.json" "$MH_SHELL" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data["hooks"]["Stop"] = [{"hooks": [{"type": "command", "command": cmd}]}]
json.dump(data, open(path, "w"))
PY
  plan
  [ "$status" -eq 0 ]
  has "migrate-hook${T}Stop${T}$MH_SHELL${T}$MH_HOOK"
  lacks "register-hook${T}Stop${T}$MH_HOOK"
}

@test "plan: opting a plugin out deregisters its shell-form entry as well as its exec form" {
  install
  python3 - "$CLAUDE/settings.json" "$MH_SHELL" <<'PY'
import json, sys
path, cmd = sys.argv[1], sys.argv[2]
data = json.load(open(path))
data["hooks"]["Stop"].append({"hooks": [{"type": "command", "command": cmd}]})
json.dump(data, open(path, "w"))
PY
  plan --skip=memory-hygiene
  [ "$status" -eq 0 ]
  has "deregister-hook${T}Stop${T}$MH_HOOK"
  has "deregister-hook${T}Stop${T}$MH_SHELL"
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
  ln -s "$FAKE_REPO/plugins/worktree-core" "$CLAUDE/skills/memory-hygiene"
  plan
  [ "$status" -eq 0 ]
  has "unlink${T}superseded${T}$CLAUDE/skills/memory-hygiene${T}$FAKE_REPO/plugins/worktree-core"
  has "link${T}$FAKE_REPO/plugins/memory-hygiene${T}$CLAUDE/skills/memory-hygiene"
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
  git_hooks_fixture
  plan --skip=demo
  [ "$status" -eq 0 ]
  has "git-hooks-path"
  local line verb
  while IFS= read -r line; do
    verb="${line%%$'\t'*}"
    case "$verb" in
      mkdir | personal-migrate | personal-create | include | claude-md | link | relink | unlink | \
        register-hook | deregister-hook | migrate-hook | default-setting | git-hooks-path | skip-plugin | skip-command | warn-foreign-symlink | warn-exists) ;;
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

# --- opt-in conventions -------------------------------------------------

# Succeeds only if $output has a line exactly equal to $1.
has_line() {
  printf '%s\n' "$output" | grep -qxF -- "$1" || {
    echo "expected plan to have the exact line: $1" >&2
    echo "plan was:" >&2
    echo "$output" >&2
    return 1
  }
}

@test "plan: an opt-in convention is not included unless asked for" {
  plan
  [ "$status" -eq 0 ]
  lacks "conventions/two.md"
  lacks "save-conventions"
}

@test "plan: --include=<opt-in convention> saves it and plans its @include" {
  plan --include=two
  [ "$status" -eq 0 ]
  has_line "save-conventions${T}$CLAUDE/agent-config.conventions${T}two"
  has_line "include${T}$FAKE_REPO/claude/conventions/two.md"
  # The save is decided before the managed block is written.
  [[ "${output%%save-conventions*}" != *"claude-md"* ]]
  # Additive: a convention-only --include does not skip any plugin.
  lacks "skip-plugin"
}

@test "plan: a convention name beside a plugin name still narrows the plugins" {
  plan --include=two,worktree-core
  [ "$status" -eq 0 ]
  has_line "include${T}$FAKE_REPO/claude/conventions/two.md"
  has "skip-plugin${T}collab-retro${T}not in --include"
  lacks "skip-plugin${T}worktree-core"
}

@test "plan: after an install with --include, a bare plan is empty (saved file is reapplied)" {
  install --include=two
  plan
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "plan: --skip=<opt-in convention> after install plans an empty save and drops the include" {
  install --include=two
  plan --skip=two
  [ "$status" -eq 0 ]
  has_line "save-conventions${T}$CLAUDE/agent-config.conventions${T}"
  lacks "conventions/two.md"
}

@test "plan: --skip=<default convention> drops its include and saves nothing" {
  plan --skip=one
  [ "$status" -eq 0 ]
  lacks "conventions/one.md"
  lacks "save-conventions"
}

@test "plan: a saved convention whose file is gone is dropped from the list" {
  install --include=two
  rm "$FAKE_REPO/claude/conventions/two.md"
  plan
  [ "$status" -eq 0 ]
  has_line "save-conventions${T}$CLAUDE/agent-config.conventions${T}"
  lacks "conventions/two.md"
}

@test "plan: hand-written convention includes in CLAUDE.personal.md are migrated, any checkout path" {
  mkdir -p "$CLAUDE"
  printf '%s\n' \
    "@/other/machine/agent-config/claude/conventions/two.md" \
    "@/other/machine/agent-config/claude/conventions/one.md" \
    "@/other/machine/agent-config/claude/conventions/gone.md" \
    "my own note" >"$CLAUDE/CLAUDE.personal.md"
  plan
  [ "$status" -eq 0 ]
  # Both repo conventions leave the personal file; only the opt-in is saved.
  has_line "strip-personal-conventions${T}$CLAUDE/CLAUDE.personal.md${T}one,two"
  has_line "save-conventions${T}$CLAUDE/agent-config.conventions${T}two"
  has_line "include${T}$FAKE_REPO/claude/conventions/two.md"
  # A convention this repo does not have is not ours to move.
  lacks "gone"
}

@test "plan: a personal file with no convention includes plans no migration" {
  mkdir -p "$CLAUDE"
  printf '%s\n' "my own note" "@/elsewhere/notes.md" >"$CLAUDE/CLAUDE.personal.md"
  plan
  [ "$status" -eq 0 ]
  lacks "strip-personal-conventions"
}

@test "plan: the migration is one-time (a bare plan after install is empty)" {
  mkdir -p "$CLAUDE"
  printf '%s\n' "@/other/machine/agent-config/claude/conventions/two.md" \
    >"$CLAUDE/CLAUDE.personal.md"
  install
  plan
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
