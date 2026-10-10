#!/usr/bin/env bash
# Update this checkout and bring the machine in line with it:
# git pull --ff-only, then ./setup.sh, then ./doctor.sh --fix.
# Stops at the first failure.
#
# Usage: ./upgrade.sh [--plan]

set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: ./upgrade.sh [--plan]

Pulls the latest main (fast-forward only), re-runs ./setup.sh, then runs
./doctor.sh --fix. Stops at the first step that fails.

Refuses to run unless this checkout is on main, has no uncommitted changes,
and can fast-forward.

  --plan      Make no changes: run './setup.sh --plan' and './doctor.sh'
              (report only) against the current checkout; no pull.
  -h, --help  Show this message and exit.
USAGE
}

PLAN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan) PLAN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

if [[ "$PLAN" == 1 ]]; then
  ./setup.sh --plan
  exec ./doctor.sh
fi

branch="$(git symbolic-ref --short -q HEAD || true)"
if [[ "$branch" != "main" ]]; then
  echo "upgrade: not on main (on '${branch:-detached HEAD}'). Switch to main first." >&2
  exit 1
fi
if ! status_out="$(git status --porcelain)"; then
  echo "upgrade: git status failed." >&2
  exit 1
fi
if [[ -n "$status_out" ]]; then
  echo "upgrade: working tree has uncommitted changes. Commit or discard them first." >&2
  exit 1
fi

echo "==> git pull --ff-only"
git pull --ff-only || {
  echo "upgrade: could not fast-forward main. Resolve it by hand, then re-run." >&2
  exit 1
}
echo "==> ./setup.sh"
./setup.sh || {
  echo "upgrade: setup.sh failed; not running doctor." >&2
  exit 1
}
echo "==> ./doctor.sh --fix"
./doctor.sh --fix || {
  echo "upgrade: doctor.sh --fix failed." >&2
  exit 1
}
