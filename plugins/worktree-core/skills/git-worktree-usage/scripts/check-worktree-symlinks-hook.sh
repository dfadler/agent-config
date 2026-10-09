#!/usr/bin/env bash
set -uo pipefail
# Legacy entrypoint for setup.sh-registered hooks (scripts/plugin-hooks.sh).
# The logic lives in plugins/worktree-core/scripts/ts/check-worktree-symlinks-hook.ts;
# remove this wrapper when setup.sh is migrated (issue #441 phase 6).
exec node "$(dirname "$0")/../../../scripts/ts/check-worktree-symlinks-hook.ts" "$@"
