#!/usr/bin/env bats
# Unit tests for scripts/check-markdown-links.sh

load helpers

setup() {
  ROOT="$BATS_TEST_TMPDIR/tree"
  mkdir -p "$ROOT"
}

check() {
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$ROOT"
}

@test "passes when a relative link resolves to a real file" {
  printf 'target\n' >"$ROOT/target.md"
  printf '[good](./target.md)\n' >"$ROOT/page.md"
  check
  assert_success
  assert_output_contains "All relative markdown links resolve"
}

@test "fails and reports a broken relative link" {
  printf '[bad](./missing.md)\n' >"$ROOT/page.md"
  check
  assert_failure
  assert_output_contains "page.md:1: broken link -> ./missing.md"
}

@test "ignores an absolute http(s) URL" {
  printf '[site](https://example.com/readme.md)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "ignores an absolute http URL (not just https)" {
  printf '[site](http://example.com)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "ignores a mailto link" {
  printf '[me](mailto:a@example.com)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "ignores an anchor-only link" {
  printf '[section](#some-heading)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "strips an anchor suffix and still checks the file part" {
  printf 'target\n' >"$ROOT/target.md"
  printf '[good](./target.md#section)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "reports every broken link, not just the first" {
  printf '[one](./missing-one.md)\n[two](./missing-two.md)\n' >"$ROOT/page.md"
  check
  assert_failure
  assert_output_contains "missing-one.md"
  assert_output_contains "missing-two.md"
}

@test "reports multiple broken links across multiple files" {
  mkdir -p "$ROOT/docs"
  printf '[bad](./nope.md)\n' >"$ROOT/page.md"
  printf '[bad](./also-nope.md)\n' >"$ROOT/docs/other.md"
  check
  assert_failure
  assert_output_contains "page.md:1: broken link -> ./nope.md"
  assert_output_contains "docs/other.md:1: broken link -> ./also-nope.md"
}

@test "resolves a link relative to the linking file's own directory" {
  mkdir -p "$ROOT/docs"
  printf 'target\n' >"$ROOT/target.md"
  printf '[up](../target.md)\n' >"$ROOT/docs/page.md"
  check
  assert_success
}

@test "falls back to a repo-root-relative resolution" {
  mkdir -p "$ROOT/a/b"
  printf 'target\n' >"$ROOT/target.md"
  # Written as if from repo root, not from a/b/page.md's own directory.
  printf '[root-relative](target.md)\n' >"$ROOT/a/b/page.md"
  check
  assert_success
}

@test "resolves a leading-slash link against the repo root" {
  printf 'target\n' >"$ROOT/target.md"
  printf '[abs](/target.md)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "a link target that is a real directory counts as resolved" {
  mkdir -p "$ROOT/some-dir"
  printf '[dir](./some-dir)\n' >"$ROOT/page.md"
  check
  assert_success
}

@test "scans a single markdown file passed via --path" {
  printf '[bad](./missing.md)\n' >"$ROOT/page.md"
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$ROOT/page.md"
  assert_failure
  assert_output_contains "broken link -> ./missing.md"
}

@test "rejects a --path that does not exist" {
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$ROOT/does-not-exist"
  assert_failure
  [ "$status" -eq 2 ]
  assert_output_contains "path not found"
}

@test "rejects a non-markdown file passed via --path" {
  printf 'hi\n' >"$ROOT/notes.txt"
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$ROOT/notes.txt"
  assert_failure
  [ "$status" -eq 2 ]
}

@test "-h prints usage and exits 0" {
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" -h
  assert_success
  assert_output_contains "Usage: check-markdown-links.sh"
}

@test "an unknown flag is a usage error" {
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --nope
  assert_failure
  [ "$status" -eq 2 ]
}

@test "passes on a directory with no markdown files" {
  mkdir -p "$ROOT/empty"
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$ROOT/empty"
  assert_success
  assert_output_contains "0 files scanned"
}

# Verified clean when this script was added (see #96): every relative link
# in this repo's own docs resolves. If this ever goes red, it's either a real
# broken link introduced elsewhere or a new false-positive class the scanner
# needs to learn about (inline code spans were the first one, already handled
# above) -- not something to silence by loosening this assertion.
@test "the repo's own tree has no broken relative markdown links" {
  run bash "$REPO_ROOT/scripts/check-markdown-links.sh" --path "$REPO_ROOT"
  assert_success
}
