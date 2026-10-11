#!/usr/bin/env bash
set -uo pipefail

# Stop hook for eval-authoring: if the work changed a plugin's skills or agents
# but no eval case, block the stop once with a reminder to update the cases and
# compare before/after scores. Silent no-op without node or git. Logic lives in
# scripts/ts/hook/stop-hook.ts. Hooks docs: https://code.claude.com/docs/en/hooks (Stop).

case "${1:-}" in
  -h | --help)
    echo "Usage: eval-gap-on-stop.sh [-h|--help]   (reads the Stop event JSON on stdin)"
    exit 0
    ;;
esac

command -v node >/dev/null 2>&1 || exit 0
command -v git >/dev/null 2>&1 || exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 0
node "$here/../../scripts/ts/hook/stop-hook.ts" || true
exit 0
