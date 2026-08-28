#!/usr/bin/env bats
# Unit tests for the gh-attach-image skill's scripts/upload.sh — specifically
# the extension -> content-type mapping (content_type_for) and the markdown
# it emits per file, since video needs different output than image (a bare
# URL, not `![alt](url)` — see SKILL.md for why).
#
# gh and curl are network calls, so they're faked here (overwriting the
# hard-blocking shims helpers.bash installs by default) rather than let
# through — no real upload ever happens. jq and python3 (used by the script
# itself for JSON parsing and URL-encoding) are left as the real system
# binaries: both are pure local computation, not network.

load helpers

UPLOAD_SCRIPT="$REPO_ROOT/plugins/dfadler-agent-config/skills/gh-attach-image/scripts/upload.sh"

# Replaces helpers.bash's network-blocking `gh` shim with one that answers
# just the two calls upload.sh makes in default mode: `gh auth token` and
# `gh api repos/OWNER/NAME --jq .id`.
shim_gh() {
  cat > "$SHIM_BIN/gh" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
case "${1:-}" in
  auth)
    if [ "${2:-}" = "token" ]; then
      echo "fake-token"
      exit 0
    fi
    echo "fake gh: unexpected auth args: $*" >&2
    exit 3
    ;;
  api)
    echo "12345"
    exit 0
    ;;
  *)
    echo "fake gh: unexpected args: $*" >&2
    exit 3
    ;;
esac
EOF
  chmod +x "$SHIM_BIN/gh"
}

# Replaces the network-blocking `curl` shim with one that logs the request
# URL (so a test can assert on the content_type query param) and replies
# with a canned, uniquely-numbered asset URL — standing in for GitHub's
# upload endpoint.
shim_curl() {
  cat > "$SHIM_BIN/curl" <<'EOF'
#!/usr/bin/env bash
set -uo pipefail
url=""
for arg in "$@"; do
  case "$arg" in
    https://uploads.github.com/*) url="$arg" ;;
  esac
done
printf '%s\n' "$url" >> "$FAKE_CURL_LOG"
n=$(($(cat "$FAKE_CURL_COUNTER" 2>/dev/null || echo 0) + 1))
echo "$n" > "$FAKE_CURL_COUNTER"
echo "{\"url\":\"https://github.com/user-attachments/assets/fake-$n\"}"
EOF
  chmod +x "$SHIM_BIN/curl"
}

setup() {
  make_sandbox
  shim_gh
  shim_curl
  FAKE_CURL_LOG="$SANDBOX/curl.log"
  FAKE_CURL_COUNTER="$SANDBOX/curl.counter"
  export FAKE_CURL_LOG FAKE_CURL_COUNTER
  FILES_DIR="$SANDBOX/files"
  mkdir -p "$FILES_DIR"
}

teardown() {
  destroy_sandbox
}

@test "prints image markdown for an image and a bare url for a video" {
  printf 'fake png bytes' > "$FILES_DIR/before.png"
  printf 'fake mp4 bytes' > "$FILES_DIR/walkthrough.mp4"

  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/before.png" "$FILES_DIR/walkthrough.mp4"
  assert_success
  assert_output_contains "![before](https://github.com/user-attachments/assets/fake-1)"
  assert_output_contains "https://github.com/user-attachments/assets/fake-2"
  # The video line must be a bare url, not wrapped in image markdown —
  # GitHub shows a broken-image icon for `![alt](url)` pointed at a video.
  refute_output_contains "![walkthrough]"
}

@test "maps mp4/mov/webm to the right content type on the upload request" {
  printf 'a' > "$FILES_DIR/a.mp4"
  printf 'b' > "$FILES_DIR/b.mov"
  printf 'c' > "$FILES_DIR/c.webm"

  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/a.mp4" "$FILES_DIR/b.mov" "$FILES_DIR/c.webm"
  assert_success
  # python3's urllib.parse.quote leaves "/" unescaped by default (safe='/'),
  # so the content_type query param carries a literal "video/..." — matching
  # what the script actually sends, not a hand-assumed percent-encoding.
  grep -q 'content_type=video/mp4' "$FAKE_CURL_LOG"
  grep -q 'content_type=video/quicktime' "$FAKE_CURL_LOG"
  grep -q 'content_type=video/webm' "$FAKE_CURL_LOG"
}

@test "still rejects an unrecognized extension, and mentions the video types now supported" {
  printf 'data' > "$FILES_DIR/clip.mkv"

  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/clip.mkv"
  assert_failure
  assert_output_contains "unrecognized extension"
  assert_output_contains "mp4/mov/webm"
}
