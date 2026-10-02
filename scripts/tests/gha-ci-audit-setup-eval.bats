#!/usr/bin/env bats
# Unit tests for plugins/gha-ci-audit/scripts/setup_eval.sh
#
# The script lays out one eval run's directory tree and writes its
# eval_metadata.json. These tests cover:
#
#   1. Usage error (exit 1) when fewer than four arguments are given
#   2. The outputs/ directory and eval_metadata.json are created
#   3. The metadata is valid JSON, with the id numeric and the prompt escaped
#   4. A second run into the same iteration directory is idempotent
#
# Everything happens inside the sandbox; no network or real project path.

load helpers

SETUP_EVAL="$REPO_ROOT/plugins/gha-ci-audit/scripts/setup_eval.sh"

setup() {
  make_sandbox
  cd "$SANDBOX" || return
}

teardown() {
  destroy_sandbox
}

# Print one top-level field of a JSON file, via the real python3 the script itself uses.
json_field() {
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$1" "$2"
}

@test "exits 1 with usage when fewer than four arguments are given" {
  run bash "$SETUP_EVAL" iteration-1 my-eval 1
  assert_status 1
  assert_output_contains "Usage:"
  [ ! -e iteration-1 ]
}

@test "creates the outputs directory and eval_metadata.json" {
  run bash "$SETUP_EVAL" iteration-1 my-eval 7 "Audit the repo"
  assert_success
  assert_output_contains "Created:"
  [ -d iteration-1/my-eval/with_skill/outputs ]
  [ -f iteration-1/my-eval/with_skill/eval_metadata.json ]
}

@test "metadata is valid JSON with a numeric id and an empty assertions list" {
  bash "$SETUP_EVAL" iteration-1 my-eval 7 "Audit the repo"
  meta=iteration-1/my-eval/with_skill/eval_metadata.json
  [ "$(json_field "$meta" eval_id)" = "7" ]
  [ "$(json_field "$meta" eval_name)" = "my-eval" ]
  [ "$(json_field "$meta" prompt)" = "Audit the repo" ]
  [ "$(json_field "$meta" assertions)" = "[]" ]
}

@test "a prompt with quotes and newlines is escaped into valid JSON" {
  prompt=$'Say "hi"\nthen stop'
  run bash "$SETUP_EVAL" iteration-1 quoted 2 "$prompt"
  assert_success
  [ "$(json_field iteration-1/quoted/with_skill/eval_metadata.json prompt)" = "$prompt" ]
}

@test "re-running into the same iteration directory overwrites the metadata" {
  bash "$SETUP_EVAL" iteration-1 my-eval 1 "first"
  run bash "$SETUP_EVAL" iteration-1 my-eval 2 "second"
  assert_success
  [ "$(json_field iteration-1/my-eval/with_skill/eval_metadata.json prompt)" = "second" ]
}
