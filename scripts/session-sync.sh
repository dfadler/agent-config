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

# A failed `git status --porcelain` (corrupted repo, permissions) also
# prints nothing, which would otherwise read as "clean" and fail OPEN into
# a merge. Capture the command's own exit status, not just its output, so
# that failure instead fails closed (skip).
working_tree_status=""
if ! working_tree_status="$(git status --porcelain 2>/dev/null)"; then
  echo "Skipping: git status failed" >&2
  exit "$EXIT_OK"
fi
if [[ -n "$working_tree_status" ]]; then
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
# SessionStart hook). ConnectTimeout bounds SSH connection setup;
# ServerAlive* additionally detects a stall *after* connecting and drops
# it. lowSpeedLimit/-Time is the HTTPS-remote equivalent (a no-op over
# SSH) so a stalled transfer is bounded on either transport.
if ! GIT_TERMINAL_PROMPT=0 \
  GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3" \
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=15 \
  fetch --quiet origin main 2>&1; then
  echo "Skipping: git fetch failed" >&2
  exit "$EXIT_OK"
fi

# Fetch is the one slow, network-bound step; re-check the checkout right
# after it in case something else (a manual `git checkout`, a concurrent
# invocation) changed it out from under us while we waited.
if ! working_tree_status="$(git status --porcelain 2>/dev/null)"; then
  echo "Skipping: git status failed after fetch" >&2
  exit "$EXIT_OK"
fi
if [[ -n "$working_tree_status" ]] ||
  [[ "$(git symbolic-ref --short HEAD 2>/dev/null)" != "main" ]]; then
  echo "Skipping: checkout changed during fetch" >&2
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
