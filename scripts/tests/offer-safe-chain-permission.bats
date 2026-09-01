#!/usr/bin/env bats
# Unit tests for scripts/offer-safe-chain-permission.sh
#
# --settings-file always points at a throwaway path under $BATS_TEST_TMPDIR,
# so a test can never touch the developer's real ~/.claude/settings.json.
# --yes/--no drive the decision directly rather than simulating a TTY: bats'
# `run` attaches no pty, so the script's own `[[ -t 0 ]]` guard would always
# read "non-interactive" and skip regardless of what's piped into stdin —
# exactly the behavior the "no interactive terminal" test below pins.

load helpers

SETTINGS=""

setup() {
  make_sandbox
  SETTINGS="$BATS_TEST_TMPDIR/settings.json"
}

teardown() {
  destroy_sandbox
}

run_offer() {
  run bash "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" --settings-file "$SETTINGS" "$@"
}

@test "--yes creates settings.json with the pinned rule" {
  run_offer --yes
  assert_success
  assert_output_contains "Added Aikido Safe Chain installer"
  jq -e '.permissions.allow | index("Bash(curl -fsSL https://github.com/AikidoSec/safe-chain/releases/download/1.5.15/install-safe-chain.sh -o /tmp/install-safe-chain.sh && echo \"de0565e3d6346407a604e84e639e95fea8758748063da2216bbfdca5feda5dd2  /tmp/install-safe-chain.sh\" | sha256sum -c - && sh /tmp/install-safe-chain.sh && rm /tmp/install-safe-chain.sh)")' \
    "$SETTINGS" >/dev/null
}

@test "--yes preserves existing keys and rules" {
  echo '{"model":"opus","permissions":{"allow":["Bash(git *)"]}}' > "$SETTINGS"
  run_offer --yes
  assert_success
  [ "$(jq -r '.model' "$SETTINGS")" = "opus" ]
  jq -e '.permissions.allow | index("Bash(git *)")' "$SETTINGS" >/dev/null
  [ "$(jq '.permissions.allow | length' "$SETTINGS")" = "2" ]
}

@test "is idempotent — running --yes twice adds the rule once" {
  run_offer --yes
  assert_success
  run_offer --yes
  assert_success
  assert_output_contains "already pre-approved"
  [ "$(jq '.permissions.allow | length' "$SETTINGS")" = "1" ]
}

@test "--no leaves no file behind" {
  run_offer --no
  assert_success
  assert_output_contains "Skipped"
  [ ! -e "$SETTINGS" ]
}

@test "skips without prompting when stdin is not a terminal" {
  run_offer
  assert_success
  assert_output_contains "Skipping Aikido Safe Chain permission prompt"
  [ ! -e "$SETTINGS" ]
}

@test "reports and fails cleanly when jq is unavailable" {
  local nojq="$BATS_TEST_TMPDIR/nojq-bin"
  mkdir -p "$nojq"
  local dir bin
  IFS=':' read -r -a dirs <<< "$PATH"
  for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue
    for bin in "$dir"/*; do
      [ -e "$bin" ] || continue
      [ "$(basename "$bin")" = "jq" ] && continue
      ln -sf "$bin" "$nojq/$(basename "$bin")" 2>/dev/null || true
    done
  done
  PATH="$nojq" run bash "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" \
    --settings-file "$SETTINGS" --yes
  assert_failure
  assert_output_contains "jq is not installed"
  [ ! -e "$SETTINGS" ]
}

@test "reports a clean error when settings.json is not valid JSON" {
  echo '{ not json' > "$SETTINGS"
  run_offer --yes
  assert_failure
  assert_output_contains "is it valid JSON"
}

@test "reports and fails cleanly when replacing settings.json fails" {
  local failbin="$BATS_TEST_TMPDIR/failing-mv-bin"
  mkdir -p "$failbin"
  cat > "$failbin/mv" <<'EOF'
#!/usr/bin/env bash
echo "stub mv: simulated failure" >&2
exit 1
EOF
  chmod +x "$failbin/mv"
  PATH="$failbin:$PATH" run_offer --yes
  assert_failure
  assert_output_contains "Failed to replace"
  # The rule was never actually committed — the placeholder from before the
  # failed mv is still what's on disk, not a false "added" report.
  [ "$(cat "$SETTINGS")" = "{}" ]
}

@test "-h prints usage and exits 0" {
  run bash "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" -h
  assert_success
  assert_output_contains "Usage:"
}

@test "rejects an unknown flag" {
  run bash "$REPO_ROOT/scripts/offer-safe-chain-permission.sh" --bogus
  assert_failure
  assert_output_contains "Unknown argument"
}
