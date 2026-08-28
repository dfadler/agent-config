#!/usr/bin/env bash
# Upload local image or video files to GitHub's user-attachments endpoint and
# print ready-to-paste markdown lines. See ../SKILL.md for the full story.
#
# Usage:
#   upload.sh --repo OWNER/NAME FILE [FILE...]
#   upload.sh --repo OWNER/NAME --pr N [--comment] [--heading "## Screenshots"] FILE [FILE...]
#   upload.sh --repo OWNER/NAME --issue N [--comment] [--heading "## Screenshots"] FILE [FILE...]
#
# Default mode (no --pr/--issue): uploads each file and prints one line per
# file to stdout, in input order — "![alt](url)" for an image, a bare url
# for a video (GitHub only renders a video player from a bare URL on its own
# line; image markdown around a video URL shows a broken-image icon).
# Nothing is saved anywhere on GitHub yet — the URLs won't resolve until a
# saved body references them (see SKILL.md). Use this mode when the files
# need to go in a specific spot in a hand-crafted body (a table, a
# particular section) rather than a simple append.
#
# --pr N / --issue N: fetches the current body, appends a heading + the
# markdown lines, and saves it back via `gh pr edit`/`gh issue edit`. Add
# --comment to post as a new comment instead of editing the body.

set -euo pipefail

REPO=""
PR=""
ISSUE=""
AS_COMMENT=0
HEADING="## Screenshots"
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --pr)
      PR="$2"
      shift 2
      ;;
    --issue)
      ISSUE="$2"
      shift 2
      ;;
    --comment)
      AS_COMMENT=1
      shift
      ;;
    --heading)
      HEADING="$2"
      shift 2
      ;;
    --)
      shift
      FILES+=("$@")
      break
      ;;
    -*)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$REPO" ]]; then
  echo "Error: --repo OWNER/NAME is required" >&2
  exit 1
fi
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Error: at least one image file is required" >&2
  exit 1
fi
if [[ -n "$PR" && -n "$ISSUE" ]]; then
  echo "Error: pass --pr or --issue, not both" >&2
  exit 1
fi

TOKEN="$(gh auth token)" || {
  echo "Error: 'gh auth token' failed — are you logged in? (gh auth login)" >&2
  exit 1
}

REPO_ID="$(gh api "repos/${REPO}" --jq .id)" || {
  echo "Error: could not resolve repository id for '${REPO}' — check the repo exists and you have access" >&2
  exit 1
}

content_type_for() {
  case "${1##*.}" in
    png) echo "image/png" ;;
    jpg | jpeg) echo "image/jpeg" ;;
    gif) echo "image/gif" ;;
    webp) echo "image/webp" ;;
    svg) echo "image/svg+xml" ;;
    apng) echo "image/apng" ;;
    mp4) echo "video/mp4" ;;
    mov) echo "video/quicktime" ;;
    webm) echo "video/webm" ;;
    *)
      echo "Error: unrecognized extension on '$1' (expected png/jpg/jpeg/gif/webp/svg/apng/mp4/mov/webm)" >&2
      exit 1
      ;;
  esac
}

MARKDOWN_LINES=()
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: file not found: $f" >&2
    exit 1
  fi
  name="$(basename "$f")"
  alt="${name%.*}"
  ctype="$(content_type_for "$f")"

  response="$(curl -sS "https://uploads.github.com/user-attachments/assets?name=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$name")&content_type=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ctype")&repository_id=${REPO_ID}" \
    -X POST \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/json" \
    --data-binary "@${f}")" || {
    echo "Error: upload request failed for '$f'" >&2
    exit 1
  }

  url="$(echo "$response" | jq -r '.url // empty')"
  if [[ -z "$url" ]]; then
    echo "Error: upload of '$f' didn't return a url. Raw response: $response" >&2
    exit 1
  fi

  # GitHub renders video from a bare URL on its own line, not image markdown
  # (`![alt](url)` gives a broken-image icon for video, since it's not img
  # markup GitHub knows how to embed as a player).
  if [[ "$ctype" == video/* ]]; then
    MARKDOWN_LINES+=("${url}")
  else
    MARKDOWN_LINES+=("![${alt}](${url})")
  fi
  echo "Uploaded ${f} -> ${url}" >&2
done

if [[ -z "$PR" && -z "$ISSUE" ]]; then
  printf '%s\n' "${MARKDOWN_LINES[@]}"
  echo "" >&2
  echo "Note: these URLs 404 until referenced inside a body that gets saved (gh pr edit/issue edit/comment). Paste the lines above into the target body and save it, THEN the URLs will resolve." >&2
  exit 0
fi

TARGET_KIND="pr"
TARGET_NUM="$PR"
if [[ -n "$ISSUE" ]]; then
  TARGET_KIND="issue"
  TARGET_NUM="$ISSUE"
fi

BLOCK="$(
  printf '%s\n\n' "$HEADING"
  printf '%s\n' "${MARKDOWN_LINES[@]}"
)"

if [[ "$AS_COMMENT" -eq 1 ]]; then
  gh "$TARGET_KIND" comment "$TARGET_NUM" --repo "$REPO" --body "$BLOCK"
  echo "Posted comment on ${TARGET_KIND} #${TARGET_NUM} in ${REPO}." >&2
else
  CURRENT_BODY="$(gh "$TARGET_KIND" view "$TARGET_NUM" --repo "$REPO" --json body --jq .body)"
  TMP="$(mktemp)"
  trap 'rm -f "$TMP"' EXIT
  printf '%s\n\n%s\n' "$CURRENT_BODY" "$BLOCK" >"$TMP"
  gh "$TARGET_KIND" edit "$TARGET_NUM" --repo "$REPO" --body-file "$TMP"
  echo "Appended to ${TARGET_KIND} #${TARGET_NUM}'s body in ${REPO} (this save is what makes the URLs above resolve)." >&2
fi
