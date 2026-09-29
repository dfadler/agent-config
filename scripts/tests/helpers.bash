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
  # A tracked file for the marker-revert fixtures (see the merged-marker-*
  # add_worktree states below) — matches the real shape (a project's own
  # tracked file some tool regenerates a block into), not a modeling
  # shortcut. Harmless for every other test, which never references it.
  echo "static content" >"$REPO/regenerated.md"
  git -C "$REPO" add regenerated.md
  git -C "$REPO" commit -q -m "add regenerated.md"
  git -C "$REPO" push -q origin main
}

# configure_cruft_marker <path> <marker> — writes $REPO/.claude/settings.json
# with a single-entry worktree.autoPruneCruftMarkers config. The script reads
# this from the MAIN checkout ($REPO here), regardless of which worktree
# under it is being classified — see read_cruft_markers's own header.
configure_cruft_marker() {
  local path="$1" marker="$2"
  mkdir -p "$REPO/.claude"
  jq -n --arg path "$path" --arg marker "$marker" \
    '{worktree: {autoPruneCruftMarkers: [{path: $path, beginMarker: $marker}]}}' \
    >"$REPO/.claude/settings.json"
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
#   merged-unpushed  merged + clean but no upstream, HEAD has a commit not on
#                    main (unpushed, unique content)                        -> keep
#   merged-no-upstream-clean  merged, no upstream, but HEAD IS main's tip (no
#                    unique content) — the ancestor-of-main fallback         -> REMOVE
#   merged-marker-block  merged + pushed, the configured marker file's only
#                    diff is the exact marker-delimited block               -> REMOVE
#                    (after the block is reverted; requires
#                    configure_cruft_marker to have been called first)
#   merged-marker-block-real-edit  merged + pushed, the marker file has a
#                    real edit mixed in alongside the block                 -> keep
#                    (left alone entirely, never reverted)
#   merged-marker-block-and-dirty  the exact block, but ALSO an unrelated
#                    dirty file                                             -> keep
#                    (the marker file must be left alone too — reverting it
#                    while the worktree is still kept would silently
#                    discard part of its dirty state)
#   merged-marker-block-no-upstream  the exact block, but no upstream AND a
#                    real unique commit                                     -> keep
#                    (same invariant: not being removed, so the marker file
#                    must not be touched either)
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
    merged-no-upstream-clean)
      # Never pushed either, but no commit was ever added — HEAD is exactly
      # main's tip, so the is-ancestor-of-main fallback must clear it.
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    merged-marker-block)
      git -C "$path" push -q -u origin "$branch"
      {
        echo ""
        echo "<!-- BEGIN:test-marker -->"
        echo "some regenerated text"
      } >>"$path/regenerated.md"
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    merged-marker-block-staged)
      # Same exact block, but `git add`ed before the script ever runs — a
      # plain `git diff --quiet` (no HEAD) would wrongly see this as already
      # clean (working tree matches the index); catches that regression.
      git -C "$path" push -q -u origin "$branch"
      {
        echo ""
        echo "<!-- BEGIN:test-marker -->"
        echo "some regenerated text"
      } >>"$path/regenerated.md"
      git -C "$path" add regenerated.md
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    merged-marker-block-real-edit)
      git -C "$path" push -q -u origin "$branch"
      {
        echo "a real edit, not just the regenerated block"
        echo ""
        echo "<!-- BEGIN:test-marker -->"
        echo "some regenerated text"
      } >>"$path/regenerated.md"
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    merged-marker-block-and-dirty)
      git -C "$path" push -q -u origin "$branch"
      {
        echo ""
        echo "<!-- BEGIN:test-marker -->"
        echo "some regenerated text"
      } >>"$path/regenerated.md"
      echo "uncommitted" >"$path/scratch.txt"
      _mark_merged "$branch" "$(git -C "$path" rev-parse HEAD)"
      ;;
    merged-marker-block-no-upstream)
      {
        echo ""
        echo "<!-- BEGIN:test-marker -->"
        echo "some regenerated text"
      } >>"$path/regenerated.md"
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

# add_orphaned_dir <name> [populate] — creates .claude/worktrees/<name> as a
# plain directory that git's own worktree list knows nothing about, simulating
# a worktree-creation call that made the directory but never completed
# `git worktree add` (real-world wreckage, not a modeling shortcut). The
# directory's mtime is "now" — pair with age_dir below to simulate one old
# enough for the sweep to consider. populate=populate drops a real file
# inside it; populate=symlink drops a (dangling) symlink instead — both must
# make the sweep leave it alone, for different reasons (real content vs. an
# entry type `find -type f` doesn't match). Prints the directory path.
add_orphaned_dir() {
  local name="$1" populate="${2:-}"
  local d="$REPO/.claude/worktrees/$name"
  mkdir -p "$d/.claude"
  case "$populate" in
    populate) echo "real content" >"$d/some-file.txt" ;;
    symlink) ln -s /nonexistent-target "$d/node_modules" ;;
  esac
  printf '%s' "$d"
}

# age_dir <path> <seconds-ago> — backdates a directory's mtime so the
# orphan-sweep's grace-period check treats it as old enough to consider.
# `touch -t` accepts the same [[CC]YY]MMDDhhmm[.SS] format on both BSD
# (macOS) and GNU touch, so no fallback branch is needed there — only `date`
# itself differs (BSD `-v-Ns`, GNU `-d "-N seconds"`).
age_dir() {
  local d="$1" seconds_ago="$2" ts
  ts="$(date -v-"${seconds_ago}"S +%Y%m%d%H%M.%S 2>/dev/null || date -d "-${seconds_ago} seconds" +%Y%m%d%H%M.%S)"
  touch -t "$ts" "$d"
}

# prune <cwd> [args...] — run the real prune-merged-worktrees.sh from <cwd>.
prune() {
  local cwd="$1"
  shift
  local script="$REPO_ROOT/plugins/worktree-core/skills/git-worktree-usage/scripts/prune-merged-worktrees.sh"
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
#        | enabled-field-before-id | frontend-design-enabled | frontend-design-disabled
#        | aws-core-enabled | aws-core-disabled | ponytail-enabled | ponytail-disabled
#        | broken
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
    frontend-design-enabled | frontend-design-disabled)
      local on=true
      [ "$mode" = "frontend-design-disabled" ] && on=false
      body='[
  {
    "id": "example-skills@anthropic-agent-skills",
    "enabled": '"$on"'
  }
]'
      ;;
    aws-core-enabled | aws-core-disabled)
      local on=true
      [ "$mode" = "aws-core-disabled" ] && on=false
      body='[
  {
    "id": "aws-core@claude-plugins-official",
    "enabled": '"$on"'
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

# A fake `rtk` CLI placed ahead of PATH so check-companions.sh's rtk checks
# never depend on whether the real rtk-ai/rtk binary happens to be installed
# on the machine running the tests (it prepends, so it shadows a real one
# further down PATH). Only implements what check-companions.sh actually
# calls: `rtk config`, printing "Config: $FAKE_RTK_CONFIG" as its first line
# — the only line check_rtk_git_exclusion reads. The config file itself is
# the calling test's responsibility to write before running check-companions.sh.
#
# Usage: shim_rtk   (always "installed"; there is no "absent" mode here —
# check_rtk's own `command -v rtk` gate was already untested before this, and
# reliably hiding a real system rtk from PATH is out of scope for this change)
shim_rtk() {
  RTK_SHIM_BIN="$SANDBOX/rtk-shim"
  mkdir -p "$RTK_SHIM_BIN"
  export FAKE_RTK_CONFIG="$SANDBOX/rtk-config.toml"
  cat > "$RTK_SHIM_BIN/rtk" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "config" ]; then
  echo "Config: $FAKE_RTK_CONFIG"
  exit 0
fi
echo "fake rtk: unexpected args: \$*" >&2
exit 1
EOF
  chmod +x "$RTK_SHIM_BIN/rtk"
  case ":$PATH:" in
    *":$RTK_SHIM_BIN:"*) ;;
    *) export PATH="$RTK_SHIM_BIN:$PATH" ;;
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
