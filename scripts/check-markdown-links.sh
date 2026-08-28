#!/usr/bin/env bash
# Verify relative Markdown links -- [text](./path/to/file.md) -- resolve to a
# real file (or directory) on disk. Adapted from dfadler1984/cursor-rules's
# .cursor/scripts/links-check.sh (spotted while triaging #26, prototyped for
# #96): this version drops that source repo's hardcoded docs/projects/*
# excludes, since none of them apply here, and adds a line number to each
# reported break.
#
# A link target is resolved two ways, in order:
#   1. relative to the linking file's own directory
#   2. relative to the repo root
# Only failing both is reported as broken. The fallback means a link written
# as if from repo root (including a leading-slash link, since base_dir//foo
# and REPO_ROOT//foo both collapse to a single slash) isn't flagged just for
# not being relative to its own file.
#
# This is a regex-based scan, not a Markdown parser: it does not know about
# fenced code blocks, so a `[text](path)`-shaped example inside a code fence
# is checked exactly like a real link. That mirrors the source script's own
# scope and is fine for this repo's docs, which don't quote link syntax in
# fences. Inline code spans (single backticks) ARE stripped before scanning,
# though, since this repo's docs do use `[alt](url)`-shaped snippets as
# illustrative examples inline -- checking those against the filesystem was a
# confirmed false-positive source when this script was first run here.
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: check-markdown-links.sh [--path <file-or-dir>]

Scans Markdown files under <path> (default: .) for [text](path) links and
verifies every relative link target resolves to a real file or directory on
disk.

Options:
  --path <path>   File or directory to scan (default: .)
  -h, --help      Show this help and exit

Skipped (not checked):
  - http:// and https:// links
  - mailto: links
  - anchor-only links (#foo)

Exit status:
  0   every relative link resolved
  1   at least one broken link was found
  2   usage error (bad flag, or --path does not exist)
USAGE
}

target="."
while [ $# -gt 0 ]; do
  case "$1" in
    --path)
      target="${2-}"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ ! -e "$target" ]; then
  echo "path not found: $target" >&2
  exit 2
fi

# Resolve the repo root once, for the fallback lookup below. Falls back to the
# scan target's own directory if this isn't inside a git checkout at all.
search_dir="$target"
[ -d "$search_dir" ] || search_dir="$(dirname "$search_dir")"
if ! REPO_ROOT="$(cd "$search_dir" && git rev-parse --show-toplevel 2>/dev/null)"; then
  REPO_ROOT="$(cd "$search_dir" && pwd)"
fi

# Collect the markdown files to scan, NUL-safe, pruning .git and node_modules.
files=()
if [ -d "$target" ]; then
  while IFS= read -r -d '' f; do
    files+=("$f")
  done < <(find "$target" \( -name .git -o -name node_modules \) -prune -o -type f -name '*.md' -print0)
else
  case "$target" in
    *.md) files+=("$target") ;;
    *)
      echo "not a markdown file: $target" >&2
      exit 2
      ;;
  esac
fi

broken=()

# Resolve one link target against the file it was found in: the linking
# file's own directory first, the repo root second.
link_resolves() {
  local base_dir="$1" link="$2"
  [ -e "$base_dir/$link" ] && return 0
  [ -e "$REPO_ROOT/$link" ] && return 0
  return 1
}

# "${files[@]}" alone trips `set -u` as an unbound variable on an empty array
# under bash < 4.4, so guard the count first rather than assume a modern bash.
for file in ${files[@]+"${files[@]}"}; do
  base_dir="$(cd "$(dirname "$file")" && pwd)"

  # The sed script below is a literal backtick-stripping pattern, not
  # something meant to expand -- single quotes are correct there.
  # shellcheck disable=SC2016
  while IFS=: read -r lineno match; do
    [ -n "${match:-}" ] || continue

    # match looks like: [text](target) -- pull out just the target.
    link="${match#*(}"
    link="${link%)}"

    # Drop an anchor suffix; a pure "#foo" anchor link disappears entirely.
    link="${link%%#*}"
    [ -n "$link" ] || continue

    case "$link" in
      http://* | https://* | mailto:*) continue ;;
    esac

    link_resolves "$base_dir" "$link" ||
      broken+=("$file:$lineno: broken link -> $link")
  done < <(sed -E 's/`[^`]*`//g' "$file" | grep -noE '\[[^]]*\]\([^)]+\)' || true)
done

if [ "${#broken[@]}" -gt 0 ]; then
  echo "::error::Broken relative markdown links:" >&2
  printf '  %s\n' "${broken[@]}" >&2
  exit 1
fi

echo "✓ All relative markdown links resolve (${#files[@]} files scanned)."
