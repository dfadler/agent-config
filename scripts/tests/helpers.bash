# Shared setup for this repo's bats suites.
#
# Every test runs HERMETICALLY — no network, no writes outside the sandbox, and
# never against the user's real ~/.claude. That matters more than usual here:
# setup.sh's whole job is creating symlinks in $HOME/.claude, so a test that
# didn't redirect HOME would rewrite the developer's live agent config.
#
#   * A shim bin/ is prepended to PATH with hard blockers for curl/wget/nc/ssh,
#     so an accidental network call fails loudly (exit 97) instead of leaving
#     the machine.
#   * HOME is redirected into the sandbox.
#   * REPO_ROOT points at the real repo, read-only — tests run the real
#     scripts as shipped rather than a copy.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"

make_sandbox() {
  SANDBOX="$(mktemp -d)"
  # Canonicalize: macOS maps /var -> /private/var, and symlink comparisons in
  # setup.sh record canonical paths, so ours have to line up.
  SANDBOX="$(cd "$SANDBOX" && pwd -P)"
  _make_shims
  export HOME="$SANDBOX/home"
  mkdir -p "$HOME"
}

destroy_sandbox() {
  [ -n "${SANDBOX:-}" ] && rm -rf "$SANDBOX"
}

_make_shims() {
  SHIM_BIN="$SANDBOX/shim-bin"
  mkdir -p "$SHIM_BIN"
  local tool
  for tool in curl wget nc ssh scp gh; do
    cat > "$SHIM_BIN/$tool" <<'EOF'
#!/usr/bin/env bash
echo "network blocked in tests: $(basename "$0") $*" >&2
exit 97
EOF
    chmod +x "$SHIM_BIN/$tool"
  done
  export PATH="$SHIM_BIN:$PATH"
}

# Extends make_sandbox for a script that runs REAL git against a remote (so
# far only session-sync.sh). git itself is not shimmed — it's the thing under
# test — but it's pointed exclusively at a local bare "origin" (a plain
# directory, not a URL), so fetch/push work with zero network, and at sandbox
# config so the developer's real gitconfig and any repo above $TMPDIR are
# invisible. Ported from dfadler.com's scripts/tests/helpers.bash, which uses
# the same pattern to test prune-merged-worktrees.sh.
#
# Sets REPO (a clone with an initial commit, pushed to origin/main) and ORIGIN
# (the bare remote) in addition to make_sandbox's own SANDBOX/HOME.
make_git_sandbox() {
  make_sandbox
  export GIT_CONFIG_GLOBAL="$SANDBOX/gitconfig"
  export GIT_CONFIG_SYSTEM=/dev/null
  # Don't let git walk above the sandbox looking for a .git — keeps a
  # "not a repo" case honest and isolates the test from any repo that happens
  # to contain $TMPDIR.
  export GIT_CEILING_DIRECTORIES="$SANDBOX"
  git config --global init.defaultBranch main
  git config --global user.name "Sync Test"
  git config --global user.email "sync-test@example.com"
  # Local-path remotes work without this on most git versions, but set it
  # defensively — some versions restrict the file transport by default.
  git config --global protocol.file.allow always

  ORIGIN="$SANDBOX/origin.git"
  REPO="$SANDBOX/repo"
  git init -q --bare "$ORIGIN"
  git init -q "$REPO"
  git -C "$REPO" commit -q --allow-empty -m "init"
  git -C "$REPO" remote add origin "$ORIGIN"
  git -C "$REPO" push -q -u origin main
}

# Build a throwaway plugin tree for the structure checker, so tests never
# depend on the repo's real plugin layout (which changes as skills are added).
# Usage: make_plugin_fixture <root> <plugin-name>
make_plugin_fixture() {
  local root="$1" plugin="$2"
  mkdir -p "$root/plugins/$plugin/.claude-plugin"
  cat > "$root/plugins/$plugin/.claude-plugin/plugin.json" <<EOF
{
  "name": "$plugin",
  "version": "0.1.0",
  "description": "fixture plugin"
}
EOF
}

# add_skill <root> <plugin> <skill> [name-override]
add_skill() {
  local root="$1" plugin="$2" skill="$3" name="${4:-$3}"
  local dir="$root/plugins/$plugin/skills/$skill"
  mkdir -p "$dir"
  cat > "$dir/SKILL.md" <<EOF
---
name: $name
description: fixture skill
---

# $skill
EOF
}

# add_agent <root> <plugin> <agent> [name-override]
add_agent() {
  local root="$1" plugin="$2" agent="$3" name="${4:-$3}"
  local dir="$root/plugins/$plugin/agents"
  mkdir -p "$dir"
  cat > "$dir/$agent.md" <<EOF
---
name: $name
description: fixture agent
---

Body.
EOF
}

# Extends make_git_sandbox with worktree-pruning fixtures: a `gh` shim that
# answers `gh auth status` / `gh pr list` from a local merged-heads file
# instead of the standard network-blocker default, plus helpers to create
# worktrees in known states. Ported from dfadler.com's own
# scripts/tests/helpers.bash, which uses the same pattern to test
# prune-merged-worktrees.sh — dropped here: that version's per-worktree
# docker/Postgres database teardown, which doesn't generalize and isn't part
# of this plugin's script.
#
# Sets GH_MERGED_HEADS_FILE in addition to make_git_sandbox's own
# SANDBOX/HOME/REPO/ORIGIN. The gh shim's behavior is driven by env vars the
# tests set:
#   GH_UNAUTHENTICATED=1   make `gh auth status` fail (simulate not logged in)
#   GH_PR_LIST_FAILS=1     make `gh pr list` fail (simulate a network/API error)
make_worktree_sandbox() {
  make_git_sandbox
  mkdir -p "$REPO/.claude/worktrees"
  _install_gh_pr_shim
}

_install_gh_pr_shim() {
  cat >"$SHIM_BIN/gh" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  auth)
    if [ -n "${GH_UNAUTHENTICATED:-}" ]; then
      echo "gh: not logged in" >&2
      exit 1
    fi
    exit 0
    ;;
  pr)
    if [ -n "${GH_PR_LIST_FAILS:-}" ]; then
      echo "gh: could not reach GitHub (simulated API error)" >&2
      exit 1
    fi
    if [ -n "${GH_MERGED_HEADS_FILE:-}" ] && [ -f "$GH_MERGED_HEADS_FILE" ]; then
      cat "$GH_MERGED_HEADS_FILE"
    fi
    exit 0
    ;;
  *)
    echo "fake gh: unexpected invocation: $*" >&2
    exit 2
    ;;
esac
EOF
  chmod +x "$SHIM_BIN/gh"
  export GH_MERGED_HEADS_FILE="$SANDBOX/merged-heads.txt"
  : >"$GH_MERGED_HEADS_FILE"
  unset GH_UNAUTHENTICATED GH_PR_LIST_FAILS
}

# _mark_merged <branch> <head-oid>
# Records one merged-PR fixture entry as branch<TAB>oid, matching the real
# `gh pr list --json headRefName,headRefOid --jq '... | @tsv'` shape the
# script's is_merged() parses. <head-oid> is required, not defaulted, so a
# caller can't accidentally record a merged PR without the commit it merged
# at — the whole point of carrying an oid is to catch a mismatch.
_mark_merged() {
  printf '%s\t%s\n' "$1" "$2" >>"$GH_MERGED_HEADS_FILE"
}

# add_worktree <name> <state> [branch]
# Creates .claude/worktrees/<name> in one of the states below. The branch
# defaults to worktree-<name>; pass an explicit [branch] to model the desktop
# app's auto-generated `claude/*` sessions, where the branch and the worktree
# directory name deliberately differ (e.g. dir `wonderful-fermat`, branch
# `claude/competent-fermi-33e7a1`).
#   merged-clean     pushed (upstream, 0 unpushed) + clean + in merged list  -> REMOVE
#   merged-dirty     merged + pushed but has an uncommitted change           -> keep
#   merged-unpushed  merged + clean but no upstream (unpushed)               -> keep
#   unmerged         clean + pushed but NOT in the merged list               -> keep
#   locked           merged + clean + pushed but git-locked                  -> keep
#   current          merged + clean + pushed (run the script from here)      -> keep
# Prints the worktree path.
add_worktree() {
  # Split declarations: within one `local`, an earlier var isn't reliably
  # visible to a later default expansion (bash 3.2 on macOS), so `branch`
  # defaulting to `worktree-$name` needs `$name` already assigned.
  local name="$1" state="$2"
  local branch="${3:-worktree-$name}"
  local path="$REPO/.claude/worktrees/$name"
  git -C "$REPO" worktree add -q -b "$branch" "$path" main

  case "$state" in
    merged-clean | locked | current)
      git -C "$path" push -q -u origin "$branch"
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      [ "$state" = "locked" ] && git -C "$REPO" worktree lock "$path"
      ;;
    merged-dirty)
      git -C "$path" push -q -u origin "$branch"
      # The uncommitted file below never becomes a commit, so it doesn't move
      # HEAD — the oid recorded here still matches what was actually pushed.
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      echo "uncommitted" >"$path/scratch.txt"
      ;;
    merged-unpushed)
      # Never pushed: no @{u}, so the script's upstream check reports unpushed.
      git -C "$path" commit -q --allow-empty -m "local only"
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    unmerged)
      git -C "$path" push -q -u origin "$branch"
      ;;
    *)
      echo "add_worktree: unknown state '$state'" >&2
      return 1
      ;;
  esac
  printf '%s' "$path"
}

# add_out_of_scope_worktree — a worktree git knows about that the script must
# NEVER classify: either outside .claude/worktrees/ or not on a worktree-* branch.
add_out_of_scope_worktree() {
  case "$1" in
    path) # right branch name, wrong location
      local p="$SANDBOX/outside-tree"
      git -C "$REPO" worktree add -q -b "worktree-outside" "$p" main
      printf '%s' "$p"
      ;;
    branch) # right location, wrong branch name
      local p="$REPO/.claude/worktrees/feature-thing"
      git -C "$REPO" worktree add -q -b "feature-thing" "$p" main
      printf '%s' "$p"
      ;;
  esac
}

# Simulate GitHub's "Automatically delete head branches" firing on merge: drop
# the branch from the bare origin while leaving the worktree's local
# remote-tracking ref (refs/remotes/origin/worktree-<name>) intact — exactly the
# state at session start, before anything has pruned it. A merged, clean, pushed
# worktree must STILL be removable here; the script must not `git fetch --prune`
# that stale ref away (doing so makes @{u} unresolvable and mis-keeps it).
delete_origin_branch() {
  local name="$1" branch="${2:-worktree-$name}"
  git -C "$ORIGIN" update-ref -d "refs/heads/$branch"
}

# prune <cwd> [args...] — run the real prune-merged-worktrees.sh from <cwd>.
prune() {
  local cwd="$1"
  shift
  local script="$REPO_ROOT/plugins/dfadler-agent-config/skills/git-worktree-usage/scripts/prune-merged-worktrees.sh"
  (cd "$cwd" && bash "$script" "$@")
}

# A fake python3 placed ahead of PATH in its own bin, so a test can suppress or
# control the pyte-probe output that check-companions.sh emits. The fake binary
# only intercepts calls shaped like the pyte probe (ones whose -c argument
# contains "EXTERNALLY-MANAGED"); everything else is forwarded to the real
# interpreter, so the plugin-listing JSON parse gets exercised for real.
#
# Usage: shim_python3 <yes|no>   (is pyte already importable)
shim_python3() {
  PY_SHIM_BIN="$SANDBOX/py-shim"
  mkdir -p "$PY_SHIM_BIN"
  # Resolved once, before this function's own directory ever reaches PATH -
  # a second call within the same test must not re-resolve into the shim
  # it already installed.
  : "${REAL_PYTHON3:=$(command -v python3)}"
  export REAL_PYTHON3
  export FAKE_PY_EXE="/fake/bin/python3"
  export FAKE_PY_MARKER="$SANDBOX/pyte-installed"
  export FAKE_PIP_LOG="$SANDBOX/pip.log"
  export FAKE_PY_MANAGED="no"
  export FAKE_PY_VENV="no"
  export FAKE_PY_BROKEN="no"
  export FAKE_PIP_EXIT="0"
  export FAKE_PIP_INSTALLS="yes"
  if [ "$1" = "yes" ]; then
    : > "$FAKE_PY_MARKER"
  else
    rm -f "$FAKE_PY_MARKER"
  fi
  cat > "$PY_SHIM_BIN/python3" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
if [ "$FAKE_PY_BROKEN" = "yes" ]; then
  echo "fake python3: unusable interpreter" >&2
  exit 1
fi
case "${1:-}" in
  -c)
    case "${2:-}" in
      *EXTERNALLY-MANAGED*)
        echo "exe=$FAKE_PY_EXE"
        if [ -e "$FAKE_PY_MARKER" ]; then echo "pyte=yes"; else echo "pyte=no"; fi
        echo "managed=$FAKE_PY_MANAGED"
        echo "venv=$FAKE_PY_VENV"
        ;;
      *)
        exec "$REAL_PYTHON3" "$@"
        ;;
    esac
    ;;
  -m)
    shift
    printf '%s\n' "$*" >> "$FAKE_PIP_LOG"
    if [ "$FAKE_PIP_INSTALLS" = "yes" ] && [ "$FAKE_PIP_EXIT" = "0" ]; then
      : > "$FAKE_PY_MARKER"
    fi
    exit "$FAKE_PIP_EXIT"
    ;;
  *)
    echo "fake python3: unexpected args: $*" >&2
    exit 3
    ;;
esac
EOF
  chmod +x "$PY_SHIM_BIN/python3"
  case ":$PATH:" in
    *":$PY_SHIM_BIN:"*) ;;
    *) export PATH="$PY_SHIM_BIN:$PATH" ;;
  esac
}

unshim_python3() {
  rm -f "$PY_SHIM_BIN/python3"
}

# A fake `claude` CLI placed ahead of PATH so check-companions.sh companion
# checks never depend on whatever the real binary would do inside the sandbox.
# Pretty-printed JSON (one field per line) to match the real CLI's output shape
# and exercise the grep-window-bug fix from #134: a compact single-line fixture
# wouldn't catch an "enabled" field preceding "id" in a neighboring object.
#
# Usage: shim_claude <mode>
# Modes: enabled | disabled | other-plugin-only | disabled-with-enabled-neighbor
#        | enabled-field-before-id | ponytail-enabled | ponytail-disabled | broken
shim_claude() {
  CLAUDE_SHIM_BIN="$SANDBOX/claude-shim"
  mkdir -p "$CLAUDE_SHIM_BIN"
  local mode="$1" body=""
  case "$mode" in
    enabled)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": true
  }
]'
      ;;
    disabled)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": false
  }
]'
      ;;
    other-plugin-only)
      body='[
  {
    "id": "dfadler-agent-config@skills-dir",
    "enabled": true
  }
]'
      ;;
    # Regression for the exact case review reproduced: a disabled target
    # sitting next to an unrelated ENABLED plugin. A window-based grep can
    # attribute the neighbor's "enabled": true to mattpocock-skills; a real
    # JSON parse can't, since it keys strictly by object.
    disabled-with-enabled-neighbor)
      body='[
  {
    "id": "mattpocock-skills@mattpocock",
    "enabled": false
  },
  {
    "id": "other-plugin@example",
    "enabled": true
  }
]'
      ;;
    # Field order within the object shouldn't matter to a real parser,
    # unlike a positional/window-based read.
    enabled-field-before-id)
      body='[
  {
    "enabled": true,
    "id": "mattpocock-skills@mattpocock"
  }
]'
      ;;
    ponytail-enabled | ponytail-disabled)
      local on=true
      [ "$mode" = "ponytail-disabled" ] && on=false
      body='[
  {
    "id": "ponytail@ponytail",
    "enabled": '"$on"'
  }
]'
      ;;
    broken) body="" ;;
    *)
      echo "shim_claude: unknown mode $mode" >&2
      return 1
      ;;
  esac
  if [ "$mode" = "broken" ]; then
    cat > "$CLAUDE_SHIM_BIN/claude" <<'EOF'
#!/usr/bin/env bash
echo "fake claude: broken" >&2
exit 1
EOF
  else
    cat > "$CLAUDE_SHIM_BIN/claude" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "plugin" ] && [ "\$2" = "list" ]; then
  echo '$body'
  exit 0
fi
echo "fake claude: unexpected args: \$*" >&2
exit 1
EOF
  fi
  chmod +x "$CLAUDE_SHIM_BIN/claude"
  case ":$PATH:" in
    *":$CLAUDE_SHIM_BIN:"*) ;;
    *) export PATH="$CLAUDE_SHIM_BIN:$PATH" ;;
  esac
}

# --- assertions (dependency-free; no bats-assert needed) --------------------
assert_success() {
  if [ "$status" -ne 0 ]; then
    echo "expected exit 0, got $status" >&2
    echo "$output" >&2
    return 1
  fi
}

assert_failure() {
  if [ "$status" -eq 0 ]; then
    echo "expected non-zero exit, got 0" >&2
    echo "$output" >&2
    return 1
  fi
}

# Pin an exact exit code, for the shared exit-code taxonomy in
# claude/CLAUDE.md's hygiene baseline (EXIT_USAGE=2, EXIT_DEPENDENCY=4, etc.).
assert_status() {
  if [ "$status" -ne "$1" ]; then
    echo "expected exit $1, got $status" >&2
    echo "$output" >&2
    return 1
  fi
}

assert_output_contains() {
  if [[ "$output" != *"$1"* ]]; then
    echo "output does not contain: $1" >&2
    echo "--- output ---" >&2
    echo "$output" >&2
    return 1
  fi
}

refute_output_contains() {
  if [[ "$output" == *"$1"* ]]; then
    echo "output should NOT contain: $1" >&2
    echo "--- output ---" >&2
    echo "$output" >&2
    return 1
  fi
}
