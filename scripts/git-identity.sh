#!/usr/bin/env bash
# Resolve the git author/committer identity (name + email) that git itself
# would use for a commit right now, and print it as shell-eval-able exports:
#   eval "$(scripts/git-identity.sh)"
#
# `git config user.name` / `user.email` already apply git's own resolution
# order (local repo config, then --global, then any `includeIf` match for
# the current directory) — so however identity is set up per machine (a
# plain global config, separate work/home configs via includeIf, whatever),
# this script doesn't need to know about it. It only adds one thing git
# doesn't: failing loudly instead of letting a caller proceed with a blank
# or half-set identity.
set -euo pipefail

name="$(git config user.name || true)"
email="$(git config user.email || true)"

missing=()
[ -z "$name" ] && missing+=("user.name")
[ -z "$email" ] && missing+=("user.email")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "error: git identity not configured: ${missing[*]}" >&2
  echo "Set it with: git config [--global] user.name \"Your Name\"" >&2
  echo "         and: git config [--global] user.email you@example.com" >&2
  exit 1
fi

printf 'export GIT_AUTHOR_NAME=%q\n' "$name"
printf 'export GIT_AUTHOR_EMAIL=%q\n' "$email"
printf 'export GIT_COMMITTER_NAME=%q\n' "$name"
printf 'export GIT_COMMITTER_EMAIL=%q\n' "$email"
