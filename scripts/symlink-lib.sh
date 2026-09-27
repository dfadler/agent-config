#!/usr/bin/env bash
# sourced-only
# Shared relative-symlink-to-absolute-path resolution. Sourced by setup.sh
# (pruning a stale/opted-out symlink) and teardown.sh (removing only a
# symlink this repo owns) — do not run directly.

# resolve_symlink_target TARGET LINK_DIR
#   Resolves TARGET (exactly as `readlink` reports it for a symlink that
#   lives in LINK_DIR) to an absolute path. readlink reports a relative
#   target as stored, so it has to be resolved before comparing it against an
#   absolute path (e.g. $REPO_ROOT/...) — otherwise a relative link into the
#   same tree reads as pointing elsewhere.
#
#   An absolute TARGET is returned unchanged. A relative TARGET is resolved
#   by cd-ing into LINK_DIR, then into TARGET's parent directory, and
#   re-appending TARGET's basename — this normalizes any leading ../ and
#   works even when TARGET no longer exists, which `realpath` cannot do
#   portably (macOS has no `realpath -m`).
#
#   Prints the resolved absolute path on stdout and returns 0. Returns 1
#   (nothing printed) if TARGET's parent directory doesn't exist or isn't
#   reachable from LINK_DIR — callers treat that the same as "not a link we
#   can own" and leave the entry alone.
resolve_symlink_target() {
  local target="$1" link_dir="$2" parent
  if [[ "$target" == /* ]]; then
    printf '%s\n' "$target"
    return 0
  fi
  parent="$(cd "$link_dir" 2>/dev/null && cd "$(dirname "$target")" 2>/dev/null && pwd)" || parent=""
  [[ -n "$parent" ]] || return 1
  printf '%s/%s\n' "$parent" "$(basename "$target")"
}
