#!/usr/bin/env bash
# Save a YouTube video's captions as plain text, plus its description.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: fetch-transcript.sh [-h|--help] <youtube-url> [output-dir]

Writes <id>.txt (captions flattened to one paragraph) and <id>.description to
output-dir (default: current directory), then prints "path|title|channel|duration".
Needs yt-dlp and jq. Retries up to 3 times, pausing RETRY_PAUSE seconds (default 30)
between rounds, because YouTube answers 429 when asked too fast. The url must start
with http:// or https://. Exit codes: 1 no captions, 2 bad usage, 127 missing tool.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
  '')
    usage >&2
    exit 2
    ;;
esac

url=$1
out=${2:-.}

case "$url" in
  http://* | https://*) ;;
  *)
    echo "fetch-transcript.sh: url must start with http:// or https://" >&2
    exit 2
    ;;
esac

for tool in yt-dlp jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "fetch-transcript.sh: $tool not found (brew install yt-dlp jq)" >&2
    exit 127
  fi
done

mkdir -p -- "$out"
cd -- "$out"

# Each yt-dlp run writes into a fresh scratch dir, so a json3 left by an earlier
# run can never be mistaken for this run's output.
work=$(mktemp -d "$PWD/.yt-fetch.XXXXXX")
trap 'rm -rf "$work"' EXIT
us=$'\037'

# The auto-generated English track is "en-orig"; "en" is a translated copy that
# YouTube rate-limits first. Fall back to any English track for manually captioned videos.
fetch() {
  rm -rf "$work/f"
  mkdir "$work/f"
  # --print implies --simulate, which would skip writing the files. Fields are
  # joined with US (0x1f) so a title containing "|" or a newline stays parseable.
  (cd "$work/f" && yt-dlp --skip-download --no-simulate --write-description --sub-format json3 \
    --print "%(id)s${us}%(title)s${us}%(channel)s${us}%(duration_string)s" \
    --write-auto-subs --write-subs --sub-langs "$1" -o '%(id)s' -- "$url" 2>"$work/err") |
    tr '\r\n\t' '   ' | sed 's/ *$//'
}

meta=''
id=''
sub=''
for attempt in 1 2 3; do
  for langs in en-orig 'en.*'; do
    meta=$(fetch "$langs") || true
    id=${meta%%"$us"*}
    # The id becomes a filename: accept only what YouTube ids are made of.
    if [[ $id =~ ^[A-Za-z0-9_-]+$ ]]; then
      for f in "$work/f/$id".en*.json3; do
        [ -e "$f" ] && sub=$f && break 3
      done
    fi
  done
  [ "$attempt" -lt 3 ] && sleep "${RETRY_PAUSE:-30}"
done

if [ -z "$sub" ]; then
  echo "no captions saved (rate limited, or the video has none)" >&2
  tail -n 5 "$work/err" >&2
  exit 1
fi

IFS=$us read -r _ title channel duration <<<"$meta"
mv -f -- "$sub" ./
[ -e "$work/f/$id.description" ] && mv -f -- "$work/f/$id.description" ./
jq -r '[.events[].segs[]?.utf8] | join("") | gsub("\\s+"; " ")' "./$(basename "$sub")" >"$id.txt"
echo "$PWD/$id.txt|${title//|//}|${channel//|//}|$duration"
