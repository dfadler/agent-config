#!/usr/bin/env bats
# Tests for plugins/eval-authoring/hooks/scripts/lint-on-edit.sh: the
# fail-open guard. PATH is a sandbox dir holding only a shim `node` that fails
# the version probe, standing in for node missing or older than 22.18.

load helpers
bats_require_minimum_version 1.5.0

HOOK="$REPO_ROOT/plugins/eval-authoring/hooks/scripts/lint-on-edit.sh"

@test "node missing or too old exits 0 with one stderr line" {
  BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$BIN"
  printf '#!/bin/sh\nexit 1\n' >"$BIN/node"
  chmod +x "$BIN/node"
  run --separate-stderr env PATH="$BIN" /bin/bash "$HOOK" </dev/null
  assert_success
  [ -z "$output" ]
  [ "$stderr" = "eval-authoring lint hook skipped: needs node 22.18 or later on PATH" ]
}
