#!/usr/bin/env bash
set -uo pipefail

# Assembles the final article.mp3 from the per-chunk OpenAI TTS output in
# $WORKDIR, once the caller's chunk loop has finished. Pulled out of
# SKILL.md's prose into its own script because this is the one piece of the
# url-to-audio flow with real branching logic — and, not coincidentally, the
# part that had two real bugs (CodeRabbit findings on PR #360): ffmpeg
# running unconditionally even on a single chunk, and a mid-loop failure
# still getting concatenated into a truncated "complete" file.
#
# Usage: assemble_audio.sh <workdir> <total_chunks> <failed:0|1>
#   workdir      Directory containing part_0001.mp3.. and concat.txt
#                (concat.txt lines: file '<path>', one per successful chunk).
#   total_chunks Number of chunks the caller's loop attempted.
#   failed       1 if any chunk failed (the loop broke early), else 0.
#
# Writes <workdir>/article.mp3 on success. Exits non-zero (and writes
# nothing) if any chunk failed, or if ffmpeg is needed but missing.

usage() {
  cat <<'USAGE'
Usage: assemble_audio.sh <workdir> <total_chunks> <failed:0|1>
USAGE
}

if [ $# -ne 3 ]; then
  usage >&2
  exit 2
fi

workdir="$1"
total="$2"
failed="$3"

case "$total" in
  '' | *[!0-9]*)
    echo "assemble_audio.sh: total_chunks must be a non-negative integer, got: $total" >&2
    exit 2
    ;;
esac
case "$failed" in
  0 | 1) : ;;
  *)
    echo "assemble_audio.sh: failed must be 0 or 1, got: $failed" >&2
    exit 2
    ;;
esac

if [ "$failed" -eq 1 ]; then
  echo "Aborting: not every chunk synthesized — refusing to ship a truncated file" >&2
  exit 1
fi

if [ "$total" -eq 1 ]; then
  cp "$workdir/part_0001.mp3" "$workdir/article.mp3"
  exit 0
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found and there is more than one chunk — stopping rather than shipping only the first chunk's audio" >&2
  exit 1
fi

ffmpeg -y -f concat -safe 0 -i "$workdir/concat.txt" -c copy "$workdir/article.mp3"
