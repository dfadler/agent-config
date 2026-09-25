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

UPLOAD_SCRIPT="$REPO_ROOT/plugins/gh-attach-image/skills/gh-attach-image/scripts/upload.sh"

# Replaces helpers.bash's network-blocking `gh` shim. Answers `gh auth token`
# and `gh api repos/OWNER/NAME --jq .id` (needed in every mode), plus
# `pr`/`issue` view/edit/comment for the --pr/--issue append and --comment
# modes — logging each call's body/args to $FAKE_GH_LOG so a test can assert
# on what upload.sh actually sent without a real GitHub call.
#
# `view` serves a different body per call, driven by $FAKE_BODY_SEQUENCE (one
# body per line; the last line repeats once calls exceed it) — upload.sh's
# retry loop reads the body twice per attempt (once at the top, once as the
# pre-write recheck), so a test simulates a concurrent edit landing between
# reads just by giving the sequence more than one line. The default sequence
# (set in setup(), below) is a single line, so every call returns the same
# body and the existing single-read-then-write tests are unaffected.
shim_gh() {
  cat >"$SHIM_BIN/gh" <<'EOF'
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
  pr | issue)
    kind="$1"
    sub="${2:-}"
    printf '%s %s %s\n' "$kind" "$sub" "$*" >> "$FAKE_GH_LOG"
    case "$sub" in
      view)
        n=$(($(cat "$FAKE_VIEW_COUNT" 2>/dev/null || echo 0) + 1))
        echo "$n" > "$FAKE_VIEW_COUNT"
        total=$(wc -l < "$FAKE_BODY_SEQUENCE" | tr -d ' ')
        line=$n
        [ "$line" -gt "$total" ] && line=$total
        sed -n "${line}p" "$FAKE_BODY_SEQUENCE"
        exit 0
        ;;
      edit)
        # find the --body-file argument and capture its contents
        prev=""
        for arg in "$@"; do
          if [ "$prev" = "--body-file" ]; then
            cat "$arg" > "$FAKE_SAVED_BODY"
          fi
          prev="$arg"
        done
        exit 0
        ;;
      comment)
        prev=""
        for arg in "$@"; do
          if [ "$prev" = "--body" ]; then
            printf '%s' "$arg" > "$FAKE_SAVED_BODY"
          fi
          prev="$arg"
        done
        exit 0
        ;;
      *)
        echo "fake gh: unexpected $kind args: $*" >&2
        exit 3
        ;;
    esac
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
  cat >"$SHIM_BIN/curl" <<'EOF'
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
  FAKE_GH_LOG="$SANDBOX/gh.log"
  FAKE_SAVED_BODY="$SANDBOX/saved-body.txt"
  FAKE_CURRENT_BODY="existing body text"
  FAKE_VIEW_COUNT="$SANDBOX/view.count"
  FAKE_BODY_SEQUENCE="$SANDBOX/body-sequence.txt"
  : >"$FAKE_GH_LOG"
  printf '%s\n' "$FAKE_CURRENT_BODY" >"$FAKE_BODY_SEQUENCE"
  export FAKE_CURL_LOG FAKE_CURL_COUNTER FAKE_GH_LOG FAKE_SAVED_BODY \
    FAKE_CURRENT_BODY FAKE_VIEW_COUNT FAKE_BODY_SEQUENCE
  FILES_DIR="$SANDBOX/files"
  mkdir -p "$FILES_DIR"
}

teardown() {
  destroy_sandbox
}

@test "prints image markdown for an image and a bare url for a video" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"
  printf 'fake mp4 bytes' >"$FILES_DIR/walkthrough.mp4"

  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/before.png" "$FILES_DIR/walkthrough.mp4"
  assert_success
  assert_output_contains "![before](https://github.com/user-attachments/assets/fake-1)"
  assert_output_contains "https://github.com/user-attachments/assets/fake-2"
  # The video line must be a bare url, not wrapped in image markdown —
  # GitHub shows a broken-image icon for `![alt](url)` pointed at a video.
  refute_output_contains "![walkthrough]"
}

@test "maps mp4/mov/webm to the right content type on the upload request" {
  printf 'a' >"$FILES_DIR/a.mp4"
  printf 'b' >"$FILES_DIR/b.mov"
  printf 'c' >"$FILES_DIR/c.webm"

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
  printf 'data' >"$FILES_DIR/clip.mkv"

  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/clip.mkv"
  assert_failure
  assert_output_contains "unrecognized extension"
  assert_output_contains "mp4/mov/webm"
}

@test "--pr appends the heading and markdown to the current body via gh pr edit" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 "$FILES_DIR/before.png"
  assert_success
  grep -q '^pr edit ' "$FAKE_GH_LOG"
  grep -q "$FAKE_CURRENT_BODY" "$FAKE_SAVED_BODY"
  grep -q '## Screenshots' "$FAKE_SAVED_BODY"
  grep -q '!\[before\](https://github.com/user-attachments/assets/fake-1)' "$FAKE_SAVED_BODY"
}

@test "--pr succeeds with exactly one edit when nothing changed concurrently" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 "$FILES_DIR/before.png"
  assert_success
  # One attempt: a top-of-loop read plus the pre-write recheck (both see the
  # same body since FAKE_BODY_SEQUENCE has one line), then a single edit.
  [ "$(grep -c '^pr view ' "$FAKE_GH_LOG")" -eq 2 ]
  [ "$(grep -c '^pr edit ' "$FAKE_GH_LOG")" -eq 1 ]
}

@test "--pr retries and preserves a concurrent body edit instead of clobbering it" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"
  # First read sees the original body; every read after that sees a body
  # someone else already changed (simulating an edit landing between
  # upload.sh's read and its pre-write recheck) — and it stays that way, so
  # the retry's own recheck matches and the write goes through.
  printf '%s\n%s\n' "$FAKE_CURRENT_BODY" "$FAKE_CURRENT_BODY -- edited by someone else" \
    >"$FAKE_BODY_SEQUENCE"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 "$FILES_DIR/before.png"
  assert_success
  # Detected the conflict once, retried, then wrote exactly once.
  [ "$(grep -c '^pr edit ' "$FAKE_GH_LOG")" -eq 1 ]
  # The newer, concurrently-edited body is preserved in what got saved...
  grep -q "edited by someone else" "$FAKE_SAVED_BODY"
  # ...with the attachment markdown appended on top of it, not instead of it.
  grep -q '!\[before\]' "$FAKE_SAVED_BODY"
}

@test "--pr gives up without overwriting when the body keeps changing every read" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"
  # Every gh view call returns a distinct body, so the pre-write recheck
  # never matches what was just read — a permanent, unresolvable conflict.
  for i in 1 2 3 4 5 6 7 8; do
    echo "body version $i"
  done >"$FAKE_BODY_SEQUENCE"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 "$FILES_DIR/before.png"
  assert_failure
  assert_output_contains "changed concurrently"
  assert_output_contains "without overwriting the newer body"
  # Never wrote anything — no edit call, no saved body.
  run grep -q '^pr edit ' "$FAKE_GH_LOG"
  [ "$status" -ne 0 ]
  [ ! -s "$FAKE_SAVED_BODY" ]
}

@test "--issue appends via gh issue edit, not gh pr edit" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --issue 7 "$FILES_DIR/before.png"
  assert_success
  grep -q '^issue edit ' "$FAKE_GH_LOG"
  refute_output_contains "pr edit"
}

@test "--comment posts a new comment instead of editing the body" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 --comment "$FILES_DIR/before.png"
  assert_success
  grep -q '^pr comment ' "$FAKE_GH_LOG"
  run grep -q '^pr edit ' "$FAKE_GH_LOG"
  [ "$status" -ne 0 ]
  grep -q '!\[before\]' "$FAKE_SAVED_BODY"
}

@test "--heading overrides the default '## Screenshots' heading" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 42 --heading "## Walkthrough" "$FILES_DIR/before.png"
  assert_success
  grep -q '## Walkthrough' "$FAKE_SAVED_BODY"
  run grep -q '## Screenshots' "$FAKE_SAVED_BODY"
  [ "$status" -ne 0 ]
}

@test "requires --repo" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" "$FILES_DIR/before.png"
  assert_failure
  assert_output_contains "--repo OWNER/NAME is required"
}

@test "requires at least one file" {
  run bash "$UPLOAD_SCRIPT" --repo owner/name
  assert_failure
  assert_output_contains "at least one image file is required"
}

@test "rejects both --pr and --issue together" {
  printf 'fake png bytes' >"$FILES_DIR/before.png"

  run bash "$UPLOAD_SCRIPT" --repo owner/name --pr 1 --issue 2 "$FILES_DIR/before.png"
  assert_failure
  assert_output_contains "pass --pr or --issue, not both"
}

@test "rejects an unknown flag" {
  run bash "$UPLOAD_SCRIPT" --repo owner/name --bogus "$FILES_DIR/before.png"
  assert_failure
  assert_output_contains "Unknown flag: --bogus"
}

@test "rejects a file that does not exist" {
  run bash "$UPLOAD_SCRIPT" --repo owner/name "$FILES_DIR/nope.png"
  assert_failure
  assert_output_contains "file not found"
}
