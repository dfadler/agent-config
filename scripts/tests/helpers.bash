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
