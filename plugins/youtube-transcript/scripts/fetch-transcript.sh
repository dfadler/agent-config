#!/usr/bin/env bash
# Save a YouTube video's captions as plain text, plus its description.
set -euo pipefail

usage() {
	cat <<'USAGE'
Usage: fetch-transcript.sh [-h|--help] <youtube-url> [output-dir]

Writes <id>.txt (captions flattened to one paragraph) and <id>.description to
output-dir (default: current directory), then prints "path|title|channel|duration".
Needs yt-dlp and jq. Retries up to 3 times, pausing RETRY_PAUSE seconds (default 30)
between rounds, because YouTube answers 429 when asked too fast.
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
mkdir -p "$out"
cd "$out"

# The auto-generated English track is "en-orig"; "en" is a translated copy that
# YouTube rate-limits first. Fall back to any English track for manually captioned videos.
fetch() {
	# --print implies --simulate, which would skip writing the files.
	yt-dlp --skip-download --no-simulate --write-description --sub-format json3 \
		--print "%(id)s|%(title)s|%(channel)s|%(duration_string)s" \
		--write-auto-subs --write-subs --sub-langs "$1" -o '%(id)s' "$url" 2>/dev/null | tail -n1
}

meta=''
id=''
sub=''
for attempt in 1 2 3; do
	for langs in en-orig 'en.*'; do
		meta=$(fetch "$langs") || true
		id=${meta%%|*}
		if [ -n "$id" ]; then
			for f in "$id".en*.json3; do
				[ -e "$f" ] && sub=$f && break 3
			done
		fi
	done
	[ "$attempt" -lt 3 ] && sleep "${RETRY_PAUSE:-30}"
done

if [ -z "$sub" ]; then
	echo "no captions saved (rate limited, or the video has none)" >&2
	exit 1
fi

jq -r '[.events[].segs[]?.utf8] | join("") | gsub("\\s+"; " ")' "$sub" >"$id.txt"
echo "$PWD/$id.txt|${meta#*|}"
