#!/usr/bin/env bats
# Unit tests for scripts/check-plugin-structure.sh
#
# Every case builds a throwaway plugin tree rather than pointing at the repo's
# real one, so adding or renaming a real skill can't turn these red.

load helpers

setup() {
  ROOT="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$ROOT"
  make_plugin_fixture "$ROOT" demo
}

check() {
  run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" "$ROOT"
}

@test "passes on a well-formed plugin" {
  add_skill "$ROOT" demo my-skill
  add_agent "$ROOT" demo my-agent
  check
  assert_success
  assert_output_contains "consistent"
}

@test "fails when the manifest is missing" {
  rm "$ROOT/plugins/demo/.claude-plugin/plugin.json"
  check
  assert_failure
  assert_output_contains "missing .claude-plugin/plugin.json"
}

@test "fails when the manifest is not valid JSON" {
  echo '{ "name": "demo",, }' > "$ROOT/plugins/demo/.claude-plugin/plugin.json"
  check
  assert_failure
  assert_output_contains "not valid JSON"
}

@test "fails when the manifest omits a required key" {
  cat > "$ROOT/plugins/demo/.claude-plugin/plugin.json" <<'EOF'
{ "name": "demo", "version": "0.1.0" }
EOF
  check
  assert_failure
  assert_output_contains "missing or empty 'description'"
}

# The rename in 37b8bef moved every directory and every name: together. This is
# the check that would have caught a half-finished one.
@test "fails when the manifest name does not match the plugin directory" {
  cat > "$ROOT/plugins/demo/.claude-plugin/plugin.json" <<'EOF'
{ "name": "stale-old-name", "version": "0.1.0", "description": "x" }
EOF
  check
  assert_failure
  assert_output_contains "does not match plugin directory 'demo'"
}

@test "fails when a skill directory has no SKILL.md" {
  mkdir -p "$ROOT/plugins/demo/skills/empty-skill"
  check
  assert_failure
  assert_output_contains "missing SKILL.md"
}

@test "fails when a skill's name does not match its directory" {
  add_skill "$ROOT" demo my-skill wrong-name
  check
  assert_failure
  assert_output_contains "does not match skill directory 'my-skill'"
}

@test "fails when an agent's name does not match its filename" {
  add_agent "$ROOT" demo my-agent wrong-name
  check
  assert_failure
  assert_output_contains "does not match filename 'my-agent'"
}

@test "fails when SKILL.md has no frontmatter delimiter" {
  mkdir -p "$ROOT/plugins/demo/skills/no-fm"
  printf '# Just a heading\n' > "$ROOT/plugins/demo/skills/no-fm/SKILL.md"
  check
  assert_failure
  assert_output_contains "frontmatter missing 'name'"
}

@test "fails when a description is present but empty" {
  mkdir -p "$ROOT/plugins/demo/skills/blank-desc"
  printf -- '---\nname: blank-desc\ndescription:\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/blank-desc/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

@test "accepts a block-scalar description (the form most skills use)" {
  mkdir -p "$ROOT/plugins/demo/skills/block-desc"
  printf -- '---\nname: block-desc\ndescription: |\n  Multi-line\n  description.\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/block-desc/SKILL.md"
  check
  assert_success
}

# A skill that documents `scripts/foo.sh` is useless if the mode bit was lost
# in review or by a filesystem that doesn't carry it.
@test "fails when a shipped skill script is not executable" {
  add_skill "$ROOT" demo scripted
  mkdir -p "$ROOT/plugins/demo/skills/scripted/scripts"
  printf '#!/usr/bin/env bash\nset -euo pipefail\n' \
    > "$ROOT/plugins/demo/skills/scripted/scripts/tool.sh"
  chmod -x "$ROOT/plugins/demo/skills/scripted/scripts/tool.sh"
  check
  assert_failure
  assert_output_contains "not executable"
}

@test "passes when that script is executable" {
  add_skill "$ROOT" demo scripted
  mkdir -p "$ROOT/plugins/demo/skills/scripted/scripts"
  printf '#!/usr/bin/env bash\nset -euo pipefail\n' \
    > "$ROOT/plugins/demo/skills/scripted/scripts/tool.sh"
  chmod +x "$ROOT/plugins/demo/skills/scripted/scripts/tool.sh"
  check
  assert_success
}

@test "reports every offender, not just the first" {
  add_skill "$ROOT" demo skill-a wrong-a
  add_skill "$ROOT" demo skill-b wrong-b
  check
  assert_failure
  assert_output_contains "skill-a"
  assert_output_contains "skill-b"
}

@test "errors when there are no plugins at all" {
  rm -rf "$ROOT/plugins"
  mkdir -p "$ROOT/plugins"
  check
  assert_failure
  assert_output_contains "no plugins found"
}

@test "the repo's own plugin tree is consistent" {
  run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" "$REPO_ROOT"
  assert_success
}
