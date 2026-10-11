#!/usr/bin/env bash
# Undo setup.sh: remove this repo's symlinks from ~/.claude/ and restore
# ~/.claude/CLAUDE.md from ~/.claude/CLAUDE.personal.md.
#
# Thin shim: the logic lives in scripts/ts/teardown.ts. Unlike setup.sh this
# runs after Node is installed (the hooks setup registers need it), so it may
# depend on it.
#
# Usage: ./teardown.sh [--commands] [--plugins] [--claude-md]

set -euo pipefail

EXIT_DEPENDENCY=4

REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# process.features.typescript is truthy from Node 22.18, the native .ts floor.
if ! command -v node >/dev/null 2>&1 ||
  ! node -e 'process.exit(process.features.typescript ? 0 : 1)' 2>/dev/null; then
  echo "teardown: Node 22.18 or newer is required (it runs scripts/ts/teardown.ts)." >&2
  exit "$EXIT_DEPENDENCY"
fi

exec node "$REPO_ROOT/scripts/ts/teardown.ts" "$@"
