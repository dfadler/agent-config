#!/usr/bin/env bash
# Fast-forward this checkout to origin/main (only when the tree is clean and
# the update is a fast-forward) and re-run setup.sh, so the symlinks under
# ~/.claude (CLAUDE.md, commands/, and the dfadler-agent-config plugin) stay
# current without a manual `git pull`. Never merges, rebases, or touches a
# dirty tree. setup.sh's own header explains why re-running it is safe.
#
# Usage: ./scripts/session-sync.sh

set -uo pipefail

EXIT_OK=0
EXIT_FAILURE=1
EXIT_USAGE=2
EXIT_DEPENDENCY=4

usage() {
  cat <<'USAGE'
Usage: ./scripts/session-sync.sh

Fast-forwards this checkout's main branch to origin/main (only when the
working tree is clean and the update is a fast-forward), then re-runs
./setup.sh so ~/.claude symlinks stay current. Intended to run from a
Claude Code SessionStart hook; safe and idempotent to run by hand too.

  -h, --help   Show this message and exit.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit "$EXIT_OK"
    ;;
  "") ;;
  *)
    echo "Unknown argument: $1" >&2
    usage >&2
    exit "$EXIT_USAGE"
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit "$EXIT_FAILURE"

command -v git >/dev/null 2>&1 || {
  echo "git not found on PATH" >&2
  exit "$EXIT_DEPENDENCY"
}

if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  echo "Skipping: working tree has uncommitted changes"
  exit "$EXIT_OK"
fi

branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ "$branch" != "main" ]]; then
  echo "Skipping: on branch '${branch:-detached HEAD}', not main"
  exit "$EXIT_OK"
fi

# GIT_TERMINAL_PROMPT=0 and BatchMode=yes stop git from blocking on an
# interactive credential/host-key prompt (this runs unattended, from a
# SessionStart hook); ConnectTimeout bounds a stalled connection instead of
# leaving it to the hook's own outer timeout.
if ! GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10" \
  git fetch --quiet origin main 2>&1; then
  echo "Skipping: git fetch failed" >&2
  exit "$EXIT_OK"
fi

local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse origin/main 2>/dev/null || true)"

if [[ -z "$remote_sha" ]]; then
  echo "Skipping: could not resolve origin/main" >&2
  exit "$EXIT_OK"
elif [[ "$local_sha" == "$remote_sha" ]]; then
  echo "Already up to date at $local_sha"
elif git merge-base --is-ancestor HEAD origin/main; then
  if git merge --ff-only origin/main; then
    echo "Fast-forwarded $local_sha -> $(git rev-parse HEAD)"
  else
    echo "Skipping: fast-forward merge failed unexpectedly" >&2
    exit "$EXIT_OK"
  fi
else
  echo "Skipping: local main has diverged from origin/main (not a fast-forward)" >&2
  exit "$EXIT_OK"
fi

./setup.sh
