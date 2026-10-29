#!/usr/bin/env bats
# Tests for plugins/eval-authoring/hooks/scripts/eval-gap-on-stop.sh: the
# fail-open guards. PATH is a sandbox dir holding only a shim `node`, so
# nothing real runs and the required tool is genuinely absent.

load helpers
bats_require_minimum_version 1.5.0

HOOK="$REPO_ROOT/plugins/eval-authoring/hooks/scripts/eval-gap-on-stop.sh"

@test "missing git exits 0 with one stderr line" {
  BIN="$BATS_TEST_TMPDIR/bin"
  mkdir -p "$BIN"
  printf '#!/bin/sh\nexit 0\n' >"$BIN/node"
  chmod +x "$BIN/node"
  run --separate-stderr env PATH="$BIN" /bin/bash "$HOOK" </dev/null
  assert_success
  [ -z "$output" ]
  [ "$stderr" = "eval-authoring stop hook skipped: needs git on PATH" ]
}
