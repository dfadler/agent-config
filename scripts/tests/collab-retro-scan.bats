#!/usr/bin/env bats
# Unit tests for the collab-retro skill's scripts/scan-feedback-memories.sh.
#
# make_sandbox redirects HOME into the sandbox, so writing memory files under
# $HOME/.claude/projects exercises the script exactly as it runs on a real
# machine, without touching the developer's actual memory.

load helpers

SCAN_SCRIPT="$REPO_ROOT/plugins/dfadler-agent-config/skills/collab-retro/scripts/scan-feedback-memories.sh"

setup() {
  make_sandbox
}

teardown() {
  destroy_sandbox
}

write_memory() {
  # write_memory <project-slug> <memory-name> <type> <extra-body-lines...>
  local project="$1" name="$2" type="$3"
  shift 3
  local dir="$HOME/.claude/projects/$project/memory"
  mkdir -p "$dir"
  {
    echo "---"
    echo "name: $name"
    echo "description: test memory"
    echo "metadata:"
    echo "  type: $type"
    echo "---"
    echo ""
    printf '%s\n' "$@"
  } >"$dir/$name.md"
}

@test "exits 0 with no output when no project has ever written memory" {
  run bash "$SCAN_SCRIPT"
  assert_success
  [ -z "$output" ]
}

@test "lists a feedback-type memory with project, name, and path" {
  write_memory "proj-a" "some-feedback" "feedback" "The rule itself." "**Why:** reasons."
  run bash "$SCAN_SCRIPT"
  assert_success
  assert_output_contains $'\tproj-a\tsome-feedback\t'
  assert_output_contains "$HOME/.claude/projects/proj-a/memory/some-feedback.md"
}

@test "skips a memory whose type is not feedback" {
  write_memory "proj-a" "not-feedback" "project" "Some project fact."
  run bash "$SCAN_SCRIPT"
  assert_success
  [ -z "$output" ]
}

@test "does not false-positive on the word feedback appearing only in the body" {
  write_memory "proj-a" "project-fact" "project" "This is unrelated to feedback at all."
  run bash "$SCAN_SCRIPT"
  assert_success
  refute_output_contains "project-fact"
}

@test "skips a feedback memory already marked surfaced by a prior collab-retro issue" {
  write_memory "proj-a" "already-surfaced" "feedback" "The rule." \
    "Surfaced as dfadler/agent-config#42 on 2026-01-01."
  run bash "$SCAN_SCRIPT"
  assert_success
  [ -z "$output" ]
}

@test "lists candidates across multiple projects, newest first" {
  write_memory "proj-a" "older" "feedback" "older rule"
  sleep 1
  write_memory "proj-b" "newer" "feedback" "newer rule"
  run bash "$SCAN_SCRIPT"
  assert_success
  newer_line=$(echo "$output" | grep -n "proj-b" | head -1 | cut -d: -f1)
  older_line=$(echo "$output" | grep -n "proj-a" | head -1 | cut -d: -f1)
  [ "$newer_line" -lt "$older_line" ]
}

@test "-h prints usage and exits 0 without scanning" {
  write_memory "proj-a" "some-feedback" "feedback" "rule"
  run bash "$SCAN_SCRIPT" -h
  assert_success
  assert_output_contains "Usage: scan-feedback-memories.sh"
  refute_output_contains "proj-a"
}

@test "rejects an unexpected extra argument" {
  run bash "$SCAN_SCRIPT" bogus
  assert_failure
  assert_output_contains "unexpected argument"
}
