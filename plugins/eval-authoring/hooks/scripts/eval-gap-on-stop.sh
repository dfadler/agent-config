#!/usr/bin/env bash
set -uo pipefail

# Stop hook for eval-authoring: if the work changed a plugin's skills or agents
# but no eval case, block the stop once with a reminder to update the cases and
# compare before/after scores. No-op without node 22.18+ or git (one stderr line each). Logic lives in
# scripts/ts/hook/stop-hook.ts. Hooks docs: https://code.claude.com/docs/en/hooks (Stop).

case "${1:-}" in
  -h | --help)
    echo "Usage: eval-gap-on-stop.sh [-h|--help]   (reads the Stop event JSON on stdin)"
    exit 0
    ;;
esac

if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' >/dev/null 2>&1; then
  echo "eval-authoring stop hook skipped: needs node 22.18 or later on PATH" >&2
  exit 0
fi
if ! command -v git >/dev/null 2>&1; then
  echo "eval-authoring stop hook skipped: needs git on PATH" >&2
  exit 0
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
node "$here/../../scripts/ts/hook/stop-hook.ts" || true
exit 0
