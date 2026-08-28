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

# Several YAML spellings LOOK like a value but resolve to null. Each of these
# passed the first version of frontmatter_has (caught in review on #60).
@test "fails on an explicit empty double-quoted description" {
  mkdir -p "$ROOT/plugins/demo/skills/dq"
  printf -- '---\nname: dq\ndescription: ""\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/dq/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

@test "fails on an explicit empty single-quoted description" {
  mkdir -p "$ROOT/plugins/demo/skills/sq"
  printf -- "---\nname: sq\ndescription: ''\n---\n\nBody\n" \
    > "$ROOT/plugins/demo/skills/sq/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

@test "fails when the description is only a comment" {
  mkdir -p "$ROOT/plugins/demo/skills/cmt"
  printf -- '---\nname: cmt\ndescription: # TODO write this\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/cmt/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

@test "fails on a block-scalar opener with no body under it" {
  mkdir -p "$ROOT/plugins/demo/skills/empty-block"
  printf -- '---\nname: empty-block\ndescription: |\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/empty-block/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

@test "fails when a block opener is followed only by a sibling key" {
  mkdir -p "$ROOT/plugins/demo/skills/block-then-key"
  printf -- '---\nname: block-then-key\ndescription: |\nlicense: MIT\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/block-then-key/SKILL.md"
  check
  assert_failure
  assert_output_contains "non-empty 'description'"
}

# YAML Core resolves exactly these four plain scalars to null.
@test "fails on the YAML null spellings" {
  local spelling
  for spelling in null Null NULL '~'; do
    rm -rf "$ROOT/plugins/demo/skills/nul"
    mkdir -p "$ROOT/plugins/demo/skills/nul"
    printf -- '---\nname: nul\ndescription: %s\n---\n\nBody\n' "$spelling" \
      > "$ROOT/plugins/demo/skills/nul/SKILL.md"
    run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" "$ROOT"
    if [ "$status" -eq 0 ]; then
      echo "description: $spelling was accepted but resolves to null" >&2
      return 1
    fi
  done
}

# The guard against over-correcting: only those exact spellings are null, so a
# case-insensitive or prefix match would wrongly reject real descriptions.
@test "accepts strings that merely look like null" {
  local spelling
  for spelling in NuLl nullable 'null and void'; do
    rm -rf "$ROOT/plugins/demo/skills/nul"
    mkdir -p "$ROOT/plugins/demo/skills/nul"
    printf -- '---\nname: nul\ndescription: %s\n---\n\nBody\n' "$spelling" \
      > "$ROOT/plugins/demo/skills/nul/SKILL.md"
    run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" "$ROOT"
    if [ "$status" -ne 0 ]; then
      echo "description: '$spelling' is a valid string but was rejected" >&2
      echo "$output" >&2
      return 1
    fi
  done
}

@test "accepts a plain scalar that carries a trailing comment" {
  mkdir -p "$ROOT/plugins/demo/skills/trailing"
  printf -- '---\nname: trailing\ndescription: a real description # note\n---\n\nBody\n' \
    > "$ROOT/plugins/demo/skills/trailing/SKILL.md"
  check
  assert_success
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

@test "-h prints usage and exits 0 without touching ROOT" {
  run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" -h
  assert_success
  assert_output_contains "Usage: check-plugin-structure.sh"
}

@test "--help prints usage and exits 0" {
  run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" --help
  assert_success
  assert_output_contains "Usage: check-plugin-structure.sh"
}

@test "exits with EXIT_FAILURE (1) when there are no plugins at all" {
  rm -rf "$ROOT/plugins"
  mkdir -p "$ROOT/plugins"
  check
  assert_status 1
}

@test "exits with EXIT_FAILURE (1) on a validation failure" {
  rm "$ROOT/plugins/demo/.claude-plugin/plugin.json"
  check
  assert_status 1
}

# Regression for the injection caught in review on #60: the manifest path used
# to be interpolated into Python source, so a plugin directory containing a
# single quote closed the literal and the rest of the path executed.
#
# The payload sits AFTER `json.load(open('<prefix>'))` on the same line, so that
# first call must succeed or the exception aborts the line before the payload
# runs — hence the real JSON file at the truncated path. Without it this test
# passes whether or not the bug is present.
@test "a plugin directory name containing a quote cannot execute code" {
  local marker="$BATS_TEST_TMPDIR/pwned.txt"
  export PWNED="$marker"
  echo '{}' > "$ROOT/plugins/x"

  local evil="$ROOT/plugins/x'));import os;open(os.environ['PWNED'],'w').write('boom');#"
  mkdir -p "$evil/.claude-plugin"
  echo '{"name":"x","version":"1","description":"d"}' > "$evil/.claude-plugin/plugin.json"

  run bash "$REPO_ROOT/scripts/check-plugin-structure.sh" "$ROOT"
  [ ! -f "$marker" ]
}
