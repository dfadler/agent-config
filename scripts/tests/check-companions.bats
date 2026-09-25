#!/usr/bin/env bats
# Unit tests for scripts/check-companions.sh — the advisory companion checks
# that setup.sh delegates to after the core symlinking is done.
#
# Each test runs against a copy of check-companions.sh inside a sandbox so
# REPO_ROOT is a throwaway path and $HOME is redirected (see helpers.bash).
# Nothing here can reach the developer's real ~/.claude.

load helpers

# shim_python3, unshim_python3, and shim_claude live in helpers.bash — loaded
# above — where they are shared with setup.bats.

setup() {
  make_sandbox
  FAKE_REPO="$SANDBOX/repo"
  mkdir -p "$FAKE_REPO/scripts"
  # Copy only what check-companions.sh reads, so the fixture stays small and
  # stable.
  cp "$REPO_ROOT/scripts/check-companions.sh" \
    "$FAKE_REPO/scripts/check-companions.sh"
  chmod +x "$FAKE_REPO/scripts/check-companions.sh"
  cp "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" \
    "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  cp "$REPO_ROOT/scripts/git-identity.sh" "$FAKE_REPO/scripts/git-identity.sh"
  chmod +x "$FAKE_REPO/scripts/git-identity.sh"
  # Default: an interpreter that already has pyte, so unrelated tests don't
  # depend on whatever is installed on the machine running them.
  shim_python3 yes
  # Same reasoning for claude: default to already-installed-and-enabled so
  # unrelated tests aren't surprised by an advisory note they didn't ask for.
  shim_claude enabled
}

teardown() {
  destroy_sandbox
}

run_companions() {
  run bash "$FAKE_REPO/scripts/check-companions.sh" "$@"
}

# --- git identity check -----------------------------------------------------
#
# scripts/git-identity.sh is the actual check (see its own bats suite); these
# tests just pin that check-companions.sh calls it and treats the result as a
# warning, not a failure. HOME is sandboxed by make_sandbox, so there's no
# global gitconfig here unless a test sets one.

@test "warns when git identity is not configured" {
  run_companions
  assert_success
  assert_output_contains "git identity (user.name/user.email) is not fully configured"
  assert_output_contains "git config --global user.name"
}

@test "confirms git identity when configured" {
  git config --global user.name "Dev Name"
  git config --global user.email "dev@example.com"
  run_companions
  assert_success
  assert_output_contains "git identity is configured"
  refute_output_contains "not fully configured"
}

# The check must reflect REPO_ROOT's git config, not whatever directory
# check-companions.sh happens to be invoked from — REPO_ROOT is derived from
# ${BASH_SOURCE[0]}, not from $PWD.
@test "git identity check reflects REPO_ROOT, not the caller's cwd" {
  git -C "$FAKE_REPO" init -q
  git -C "$FAKE_REPO" config user.name "Repo Name"
  git -C "$FAKE_REPO" config user.email "repo@example.com"

  mkdir -p "$SANDBOX/elsewhere"
  git -C "$SANDBOX/elsewhere" init -q
  # No identity here, and no global config either (HOME is sandboxed) — if
  # the check ran relative to this directory it would report unconfigured.

  run bash -c 'cd "$1" && bash "$2/scripts/check-companions.sh"' \
    -- "$SANDBOX/elsewhere" "$FAKE_REPO"
  assert_success
  assert_output_contains "git identity is configured"
  refute_output_contains "not fully configured"
}

# --- runtime dependency check (#88) ----------------------------------------
#
# detached-terminal's agent_term.py runs under whatever python3 is first on
# PATH, so check-companions.sh checks THAT interpreter. The fake python3
# above stands in for it; the last test in this file checks the probe against
# the real one.

@test "reports a missing pyte against the interpreter that would run the skill" {
  shim_python3 no
  run_companions
  # A missing dependency is a warning, so the script still exits 0.
  assert_success
  assert_output_contains "pyte is NOT installed for /fake/bin/python3"
  assert_output_contains "python3 -m pip install --user pyte"
  assert_output_contains "./setup.sh --install-deps"
}

@test "verifying never installs anything on its own" {
  shim_python3 no
  run_companions
  assert_success
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "confirms a pyte that is already importable" {
  shim_python3 yes
  run_companions
  assert_success
  assert_output_contains "pyte is importable by /fake/bin/python3"
  refute_output_contains "NOT installed"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps installs into the user site" {
  shim_python3 no
  run_companions --install-deps
  assert_success
  assert_output_contains "pyte installed and importable"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

# --user is an error inside a virtualenv, so the flag has to come off there.
@test "--install-deps drops --user inside a virtualenv" {
  shim_python3 no
  export FAKE_PY_VENV=yes
  run_companions --install-deps
  assert_success
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install pyte" ]
}

# PEP 668: pip would refuse with a wall of text. Say the useful thing instead.
@test "--install-deps explains rather than running a doomed pip when externally managed" {
  shim_python3 no
  export FAKE_PY_MANAGED=yes
  run_companions --install-deps
  assert_failure
  assert_output_contains "externally managed"
  assert_output_contains "break-system-packages"
  [ ! -e "$FAKE_PIP_LOG" ]
}

@test "--install-deps fails loudly when pip fails" {
  shim_python3 no
  export FAKE_PIP_EXIT=1
  run_companions --install-deps
  assert_failure
  assert_output_contains "pip install failed"
  assert_output_contains "python3 -m pip install --user pyte"
}

# pip can exit 0 having installed somewhere this interpreter doesn't search.
# The import is the fact that matters, so it is re-checked afterwards.
@test "--install-deps trusts the import, not pip's exit status" {
  shim_python3 no
  export FAKE_PIP_INSTALLS=no
  run_companions --install-deps
  assert_failure
  assert_output_contains "pip reported success"
  [ "$(cat "$FAKE_PIP_LOG")" = "pip install --user pyte" ]
}

@test "an unusable python3 is reported without failing" {
  shim_python3 no
  export FAKE_PY_BROKEN=yes
  run_companions
  assert_success
  assert_output_contains "Could not run python3"
}

# --- companion plugin check (#134) ------------------------------------------
#
# Purely advisory — nothing here depends on mattpocock-skills, unlike pyte,
# so every case below asserts the script still exits 0 and there's no
# --install-deps equivalent to test.

@test "confirms mattpocock-skills when installed and enabled" {
  shim_claude enabled
  run_companions
  assert_success
  assert_output_contains "✓ mattpocock-skills is installed"
}

@test "warns when mattpocock-skills is installed but disabled" {
  shim_claude disabled
  run_companions
  assert_success
  assert_output_contains "installed but disabled"
  assert_output_contains "claude plugin enable mattpocock-skills"
}

# Regression (review on #134): the original implementation grepped a fixed
# line window after the id line for "enabled": true, which could pick up a
# NEIGHBORING plugin's field instead of the matched one's.
@test "a disabled target isn't misread as enabled via a neighboring plugin" {
  shim_claude disabled-with-enabled-neighbor
  run_companions
  assert_success
  assert_output_contains "installed but disabled"
  refute_output_contains "✓ mattpocock-skills is installed"
}

# Regression (review on #134): field order within the JSON object shouldn't
# matter to a real parser, unlike a positional/window-based read.
@test "field order within the plugin object doesn't confuse detection" {
  shim_claude enabled-field-before-id
  run_companions
  assert_success
  assert_output_contains "✓ mattpocock-skills is installed"
}

@test "notes when mattpocock-skills is not installed" {
  shim_claude other-plugin-only
  run_companions
  assert_success
  assert_output_contains "mattpocock-skills is not installed"
  assert_output_contains "claude plugin install mattpocock-skills"
}

@test "stays silent about mattpocock-skills when the claude CLI errors" {
  shim_claude broken
  run_companions
  assert_success
  refute_output_contains "mattpocock-skills"
}

# --- ponytail companion check (#275) ----------------------------------------
#
# Same advisory posture as mattpocock-skills above; pins the
# "ponytail@ponytail" id prefix and the marketplace-add install hint.

@test "confirms ponytail when installed and enabled" {
  shim_claude ponytail-enabled
  run_companions
  assert_success
  assert_output_contains "✓ ponytail is installed"
}

@test "warns when ponytail is installed but disabled" {
  shim_claude ponytail-disabled
  run_companions
  assert_success
  assert_output_contains "claude plugin enable ponytail"
}

@test "notes when ponytail is not installed" {
  shim_claude other-plugin-only
  run_companions
  assert_success
  assert_output_contains "ponytail is not installed"
  assert_output_contains "claude plugin marketplace add DietrichGebert/ponytail"
}

@test "stays silent about ponytail when the claude CLI errors" {
  shim_claude broken
  run_companions
  assert_success
  refute_output_contains "ponytail"
}

# --- Aikido Safe Chain permission offer (advisory) --------------------------
#
# offer-safe-chain-permission.sh has its own bats suite; these tests just pin
# that check-companions.sh calls it as the final step and treats its failure
# as advisory via `|| true` rather than letting it end the run — that script
# can genuinely return nonzero (missing jq, a corrupt settings.json).

@test "runs the Aikido Safe Chain offer as the final step" {
  run_companions
  assert_success
  assert_output_contains "Skipping Aikido Safe Chain permission prompt"
}

@test "a failing Aikido Safe Chain offer does not fail check-companions.sh" {
  cat > "$FAKE_REPO/scripts/offer-safe-chain-permission.sh" <<'EOF'
#!/usr/bin/env bash
echo "stub offer script: simulated failure" >&2
exit 1
EOF
  chmod +x "$FAKE_REPO/scripts/offer-safe-chain-permission.sh"
  run_companions
  assert_success
  assert_output_contains "stub offer script: simulated failure"
}

# --- argument parsing -------------------------------------------------------

@test "--help prints usage and runs no checks" {
  run_companions --help
  assert_success
  assert_output_contains "--install-deps"
  refute_output_contains "git identity"
  refute_output_contains "pyte is NOT"
}

@test "an unknown argument exits 2" {
  run_companions --nope
  [ "$status" -eq 2 ]
  assert_output_contains "Unknown argument: --nope"
}

# --- probe contract test ----------------------------------------------------
#
# The fake python3 answers the probe by fiat, so none of the tests above can
# catch a probe SCRIPT that doesn't work (wrong field names, an exception, a
# Python version that lacks something it uses). This one runs the real
# interpreter and pins the probe's answer to independently observed truth.
# Still hermetic: reading the local interpreter touches no network.

# --- convention dependency check --------------------------------------------
#
# check_convention_deps reads CONVENTION_DEPS from FAKE_REPO and @-include
# lines from $HOME/.claude/CLAUDE.md and CLAUDE.personal.md.  Helpers below
# set up those fixtures without touching the real repo or the developer's
# ~/.claude.

# Write a minimal CONVENTION_DEPS file into FAKE_REPO.
make_deps_file() {
  mkdir -p "$FAKE_REPO/claude/conventions"
  printf '%s\n' "$@" > "$FAKE_REPO/claude/conventions/CONVENTION_DEPS"
}

# Write CLAUDE.md (and an empty CLAUDE.personal.md) that @-include the given
# convention filenames from FAKE_REPO.  Called with no arguments the files
# exist but include nothing, which lets check_convention_deps run its early
# "no included conventions" return path.
set_active_conventions() {
  mkdir -p "$HOME/.claude"
  : > "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"
  local c
  for c in "$@"; do
    echo "@$FAKE_REPO/claude/conventions/$c" >> "$HOME/.claude/CLAUDE.md"
  done
}

# Create a real (non-dangling) plugin directory and symlink it under
# ~/.claude/skills/ so the check treats it as linked.
link_plugin() {
  local plugin="$1"
  mkdir -p "$SANDBOX/fake-plugins/$plugin"
  mkdir -p "$HOME/.claude/skills"
  ln -s "$SANDBOX/fake-plugins/$plugin" "$HOME/.claude/skills/$plugin"
}

# Create a symlink that points nowhere, simulating a plugin whose directory
# was removed after setup.sh ran.
link_plugin_dangling() {
  local plugin="$1"
  mkdir -p "$HOME/.claude/skills"
  ln -s "$SANDBOX/nonexistent-$plugin" "$HOME/.claude/skills/$plugin"
}

@test "no warning when convention dep is satisfied by a linked plugin" {
  make_deps_file "my-convention.md:my-plugin"
  set_active_conventions "my-convention.md"
  link_plugin "my-plugin"
  run_companions
  assert_success
  refute_output_contains "Convention my-convention.md"
}

@test "warns when convention dep plugin is not linked" {
  make_deps_file "my-convention.md:my-plugin"
  set_active_conventions "my-convention.md"
  run_companions
  assert_success
  assert_output_contains "Convention my-convention.md is active but its required plugin is not linked"
  assert_output_contains "./setup.sh --include=my-plugin"
}

@test "check exits 0 even when a convention dep is missing" {
  make_deps_file "my-convention.md:my-plugin"
  set_active_conventions "my-convention.md"
  run_companions
  assert_success
}

@test "no warning when convention has a dep entry but is not included" {
  make_deps_file "other.md:some-plugin"
  set_active_conventions  # nothing included
  run_companions
  assert_success
  refute_output_contains "Convention other.md"
}

@test "no warning when CONVENTION_DEPS file does not exist" {
  # No make_deps_file call: file is absent from FAKE_REPO.
  set_active_conventions "any.md"
  run_companions
  assert_success
  refute_output_contains "Convention"
}

@test "first of pipe-separated alternatives satisfies the dep" {
  make_deps_file "my-convention.md:plugin-a|plugin-b"
  set_active_conventions "my-convention.md"
  link_plugin "plugin-a"
  run_companions
  assert_success
  refute_output_contains "Convention my-convention.md"
}

@test "second of pipe-separated alternatives satisfies the dep" {
  make_deps_file "my-convention.md:plugin-a|plugin-b"
  set_active_conventions "my-convention.md"
  link_plugin "plugin-b"
  run_companions
  assert_success
  refute_output_contains "Convention my-convention.md"
}

@test "warns and lists both options when neither alternative is linked" {
  make_deps_file "my-convention.md:plugin-a|plugin-b"
  set_active_conventions "my-convention.md"
  run_companions
  assert_success
  assert_output_contains "Convention my-convention.md is active but its required plugin is not linked"
  assert_output_contains "plugin-a or plugin-b"
  assert_output_contains "./setup.sh --include=plugin-a"
  assert_output_contains "./setup.sh --include=plugin-b"
}

@test "a dangling plugin symlink does not satisfy the dep" {
  make_deps_file "my-convention.md:my-plugin"
  set_active_conventions "my-convention.md"
  link_plugin_dangling "my-plugin"
  run_companions
  assert_success
  assert_output_contains "Convention my-convention.md is active but its required plugin is not linked"
}

@test "convention included from a foreign repo does not trigger a warning" {
  make_deps_file "my-convention.md:my-plugin"
  # Path is under /some/other/repo, not FAKE_REPO.
  mkdir -p "$HOME/.claude"
  echo "@/some/other/repo/claude/conventions/my-convention.md" > "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"
  run_companions
  assert_success
  refute_output_contains "Convention my-convention.md"
}

@test "convention included via CLAUDE.personal.md is checked" {
  make_deps_file "personal-convention.md:my-plugin"
  mkdir -p "$HOME/.claude"
  : > "$HOME/.claude/CLAUDE.md"
  echo "@$FAKE_REPO/claude/conventions/personal-convention.md" \
    > "$HOME/.claude/CLAUDE.personal.md"
  run_companions
  assert_success
  assert_output_contains "Convention personal-convention.md is active but its required plugin is not linked"
}

@test "only this repo's convention match fires, not a same-named one from another repo" {
  make_deps_file "shared-name.md:my-plugin"
  mkdir -p "$HOME/.claude"
  # One include from a foreign repo (should not match), one from FAKE_REPO (should match).
  {
    echo "@/other/repo/claude/conventions/shared-name.md"
    echo "@$FAKE_REPO/claude/conventions/shared-name.md"
  } > "$HOME/.claude/CLAUDE.md"
  touch "$HOME/.claude/CLAUDE.personal.md"
  run_companions
  assert_success
  # The FAKE_REPO include is unsatisfied — warning must fire exactly once.
  assert_output_contains "Convention shared-name.md is active but its required plugin is not linked"
}

@test "satisfied dep for one convention does not suppress warning for another" {
  make_deps_file \
    "conv-a.md:plugin-a" \
    "conv-b.md:plugin-b"
  set_active_conventions "conv-a.md" "conv-b.md"
  link_plugin "plugin-a"
  # plugin-b is absent
  run_companions
  assert_success
  refute_output_contains "Convention conv-a.md"
  assert_output_contains "Convention conv-b.md is active but its required plugin is not linked"
}

# --- probe contract test (must stay last) -----------------------------------

@test "the probe reports the real python3 correctly" {
  unshim_python3
  command -v python3 > /dev/null 2>&1 || skip "no python3 on PATH"
  local exe expected
  exe="$(python3 -c 'import sys; print(sys.executable)')"
  if python3 -c 'import pyte' 2>/dev/null; then
    expected="pyte is importable by $exe"
  else
    expected="pyte is NOT installed for $exe"
  fi
  run_companions
  assert_success
  assert_output_contains "$expected"
}
