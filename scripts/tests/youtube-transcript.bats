#!/usr/bin/env bats
# Tests for plugins/youtube-transcript/scripts/fetch-transcript.sh. A fake
# `yt-dlp` on PATH stands in for the network: it logs its arguments and writes
# the files the real one would, so nothing here touches YouTube.

load helpers
bats_require_minimum_version 1.5.0

SCRIPT="$REPO_ROOT/plugins/youtube-transcript/scripts/fetch-transcript.sh"

setup() {
  BIN="$BATS_TEST_TMPDIR/bin"
  OUT="$BATS_TEST_TMPDIR/out"
  CALLS="$BATS_TEST_TMPDIR/calls"
  mkdir -p "$BIN"
  : >"$CALLS"
  export CALLS RETRY_PAUSE=0
}

# fake_ytdlp <succeed-on-call> <track>: writes captions only from the Nth call
# on, as <track> ("en-orig" or "en"). Every call logs its arguments and prints
# the --print line.
fake_ytdlp() {
  cat >"$BIN/yt-dlp" <<EOF
#!/bin/bash
echo "\$*" >>"$CALLS"
n=\$(wc -l <"$CALLS")
if [ "\$n" -ge $1 ]; then
  printf '{"events":[{"segs":[{"utf8":"Hello  "},{"utf8":"there\\\\n"}]},{"segs":[{"utf8":"world"}]}]}' >"\${FAKE_ID:-abc123}.$2.json3"
fi
echo "line from description" >"\${FAKE_ID:-abc123}.description"
printf '%s\\037%s\\037%s\\037%s\\n' "\${FAKE_ID:-abc123}" "\${FAKE_TITLE:-A Title}" "A Channel" "1:23"
EOF
  chmod +x "$BIN/yt-dlp"
}

run_script() {
  run --separate-stderr env PATH="$BIN:$PATH" /bin/bash "$SCRIPT" "$@"
}

@test "--help prints usage and exits 0" {
  run /bin/bash "$SCRIPT" --help
  assert_success
  assert_output_contains "Usage: fetch-transcript.sh"
}

@test "no arguments prints usage to stderr and exits 2" {
  run --separate-stderr /bin/bash "$SCRIPT"
  assert_status 2
  grep -qF "Usage: fetch-transcript.sh" <<<"$stderr"
}

@test "saves flattened captions and prints path|title|channel|duration" {
  fake_ytdlp 1 en-orig
  run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  [ "$output" = "$OUT/abc123.txt|A Title|A Channel|1:23" ]
  [ "$(cat "$OUT/abc123.txt")" = "Hello there world" ]
  [ -f "$OUT/abc123.description" ]
}

@test "asks for en-orig, json3 and --no-simulate" {
  fake_ytdlp 1 en-orig
  run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  first=$(head -n1 "$CALLS")
  # grep, not [[ ]]: a failing [[ mid-test does not fail the test on bash 3.2.
  grep -qF -- "--no-simulate" <<<"$first"
  grep -qF -- "--sub-langs en-orig" <<<"$first"
  grep -qF -- "--sub-format json3" <<<"$first"
  grep -qF -- "--write-description" <<<"$first"
}

@test "falls back to any English track when en-orig yields nothing" {
  fake_ytdlp 2 en
  run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  [ "$(wc -l <"$CALLS")" -eq 2 ]
  sed -n 2p "$CALLS" | grep -qF -- "--sub-langs en.*"
  [ "$(cat "$OUT/abc123.txt")" = "Hello there world" ]
}

@test "retries after a failed round and succeeds on a later one" {
  fake_ytdlp 3 en-orig
  run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  [ "$(wc -l <"$CALLS")" -eq 3 ]
  [ -f "$OUT/abc123.txt" ]
}

@test "gives up after three rounds with no captions: exit 1 and a message" {
  fake_ytdlp 99 en-orig
  run_script "https://youtu.be/abc123" "$OUT"
  assert_status 1
  grep -qF "no captions saved" <<<"$stderr"
  [ "$(wc -l <"$CALLS")" -eq 6 ]
  [ ! -f "$OUT/abc123.txt" ]
}

@test "a -x style url is rejected before yt-dlp runs" {
  fake_ytdlp 1 en-orig
  run_script "--exec=touch $BATS_TEST_TMPDIR/pwned" "$OUT"
  assert_status 2
  [ ! -s "$CALLS" ]
  [ ! -e "$BATS_TEST_TMPDIR/pwned" ]
}

@test "url reaches yt-dlp only after a -- separator" {
  fake_ytdlp 1 en-orig
  run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  grep -qF -- " -- https://youtu.be/abc123" "$CALLS"
}

@test "a non-http url is rejected with exit 2" {
  fake_ytdlp 1 en-orig
  run_script "file:///etc/passwd" "$OUT"
  assert_status 2
  grep -qF "http" <<<"$stderr"
  [ ! -s "$CALLS" ]
}

@test "missing yt-dlp exits 127 at once, without retry pauses" {
  mkdir -p "$BATS_TEST_TMPDIR/nobin"
  printf '#!/bin/sh\n' >"$BATS_TEST_TMPDIR/nobin/jq"
  chmod +x "$BATS_TEST_TMPDIR/nobin/jq"
  run --separate-stderr env PATH="$BATS_TEST_TMPDIR/nobin" RETRY_PAUSE=30 /bin/bash "$SCRIPT" "https://youtu.be/abc123" "$OUT"
  assert_status 127
  grep -qF "yt-dlp not found" <<<"$stderr"
}

@test "a json3 left by an earlier run is not accepted" {
  fake_ytdlp 99 en-orig
  mkdir -p "$OUT"
  echo '{"events":[{"segs":[{"utf8":"stale"}]}]}' >"$OUT/abc123.en-orig.json3"
  run_script "https://youtu.be/abc123" "$OUT"
  assert_status 1
  [ ! -f "$OUT/abc123.txt" ]
}

@test "a title with | and a newline still yields one four-field line" {
  fake_ytdlp 1 en-orig
  FAKE_TITLE=$'Pipes | and\nnewline' run_script "https://youtu.be/abc123" "$OUT"
  assert_success
  [ "$(wc -l <<<"$output")" -eq 1 ]
  [ "$output" = "$OUT/abc123.txt|Pipes / and newline|A Channel|1:23" ]
}

@test "a video id that is not filename-safe is refused" {
  fake_ytdlp 1 en-orig
  FAKE_ID='../evil' run_script "https://youtu.be/abc123" "$OUT"
  assert_status 1
  [ ! -e "$BATS_TEST_TMPDIR/evil.txt" ]
  [ ! -e "$OUT/../evil.txt" ]
}
