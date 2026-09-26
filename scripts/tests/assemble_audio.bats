#!/usr/bin/env bats
#
# Tests for plugins/dfadler-agent-config/skills/url-to-audio/scripts/assemble_audio.sh
# — the assembly-decision logic pulled out of the url-to-audio SKILL.md
# during PR #360's review, since it's where two real bugs lived: ffmpeg
# running unconditionally on a single chunk, and a mid-loop chunk failure
# still getting concatenated into a truncated "complete" file.
#
# Hermetic: a real ffmpeg is never required. A fake `ffmpeg` shim is placed
# at the front of PATH so tests can control whether it's "installed" and
# observe whether it was invoked, without touching a real audio toolchain.

REAL_SCRIPT="$BATS_TEST_DIRNAME/../../plugins/dfadler-agent-config/skills/url-to-audio/scripts/assemble_audio.sh"

setup() {
  TMP="$(mktemp -d)"
  WORKDIR="$TMP/work"
  mkdir -p "$WORKDIR"

  FAKE_BIN="$TMP/bin"
  mkdir -p "$FAKE_BIN"
}

teardown() {
  [ -n "${TMP:-}" ] && rm -rf "$TMP"
}

# Installs a fake `ffmpeg` on PATH that records each invocation and writes a
# marker file at its concat-demuxer output path, standing in for a real
# transcode without needing real audio input.
_install_fake_ffmpeg() {
  cat >"$FAKE_BIN/ffmpeg" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_FFMPEG_LOG"
# Last arg is the -c copy output path.
out="${@: -1}"
echo "concatenated" > "$out"
EOF
  chmod +x "$FAKE_BIN/ffmpeg"
  export FAKE_FFMPEG_LOG="$TMP/ffmpeg.log"
  : > "$FAKE_FFMPEG_LOG"
}

_run_assemble() {
  PATH="$FAKE_BIN:$PATH" run bash "$REAL_SCRIPT" "$WORKDIR" "$1" "$2"
}

@test "wrong argument count is a usage error" {
  run bash "$REAL_SCRIPT" "$WORKDIR" 1
  [ "$status" -eq 2 ]
}

@test "non-numeric total_chunks is rejected" {
  run bash "$REAL_SCRIPT" "$WORKDIR" not-a-number 0
  [ "$status" -eq 2 ]
}

@test "failed=1 aborts without touching ffmpeg, even for a single chunk" {
  _install_fake_ffmpeg
  echo fake-audio > "$WORKDIR/part_0001.mp3"
  _run_assemble 1 1
  [ "$status" -ne 0 ]
  [ ! -e "$WORKDIR/article.mp3" ]
  [ ! -s "$FAKE_FFMPEG_LOG" ]
}

@test "failed=1 with multiple chunks aborts without concatenating partial output" {
  _install_fake_ffmpeg
  echo fake-audio > "$WORKDIR/part_0001.mp3"
  printf "file '%s'\n" "$WORKDIR/part_0001.mp3" > "$WORKDIR/concat.txt"
  _run_assemble 3 1
  [ "$status" -ne 0 ]
  [ ! -e "$WORKDIR/article.mp3" ]
  [ ! -s "$FAKE_FFMPEG_LOG" ]
}

@test "a single successful chunk is copied directly, without invoking ffmpeg" {
  _install_fake_ffmpeg
  echo fake-audio > "$WORKDIR/part_0001.mp3"
  _run_assemble 1 0
  [ "$status" -eq 0 ]
  [ "$(cat "$WORKDIR/article.mp3")" = "fake-audio" ]
  [ ! -s "$FAKE_FFMPEG_LOG" ]
}

@test "multiple successful chunks are concatenated via ffmpeg" {
  _install_fake_ffmpeg
  echo fake-audio-1 > "$WORKDIR/part_0001.mp3"
  echo fake-audio-2 > "$WORKDIR/part_0002.mp3"
  printf "file '%s'\n" "$WORKDIR/part_0001.mp3" > "$WORKDIR/concat.txt"
  printf "file '%s'\n" "$WORKDIR/part_0002.mp3" >> "$WORKDIR/concat.txt"
  _run_assemble 2 0
  [ "$status" -eq 0 ]
  [ -s "$WORKDIR/article.mp3" ]
  [ -s "$FAKE_FFMPEG_LOG" ]
}

@test "multiple chunks but ffmpeg missing: aborts rather than shipping only the first chunk" {
  # A minimal PATH with only what the script itself needs — no ffmpeg
  # anywhere on it, even if this machine has a real one installed elsewhere
  # on the normal PATH.
  minimal_bin="$TMP/minimal-bin"
  mkdir -p "$minimal_bin"
  for tool in bash sh cat cp mkdir printf command; do
    real="$(command -v "$tool" 2>/dev/null)" || continue
    ln -s "$real" "$minimal_bin/$tool"
  done

  echo fake-audio-1 > "$WORKDIR/part_0001.mp3"
  echo fake-audio-2 > "$WORKDIR/part_0002.mp3"
  printf "file '%s'\n" "$WORKDIR/part_0001.mp3" > "$WORKDIR/concat.txt"
  printf "file '%s'\n" "$WORKDIR/part_0002.mp3" >> "$WORKDIR/concat.txt"
  run env -i PATH="$minimal_bin" bash "$REAL_SCRIPT" "$WORKDIR" 2 0
  [ "$status" -ne 0 ]
  [ ! -e "$WORKDIR/article.mp3" ]
}
