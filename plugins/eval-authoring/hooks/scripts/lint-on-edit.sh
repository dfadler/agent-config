#!/usr/bin/env bash
set -uo pipefail

# PostToolUse hook for eval-authoring: lint the eval cases after Claude edits a
# file under the plugin's eval directory, and report findings back as context.
#
# This wrapper exists only so the hook can never fail a session: it needs
# `node` (22.18 or later, to run the TypeScript directly), and when node is
# missing or too old it must stay silent and exit 0 rather than report a
# "command not found". All the logic (finding the plugin and eval directory,
# no-op outside them, running the lint) is in scripts/ts/hook/lint-hook.ts.
# Hooks docs: https://code.claude.com/docs/en/hooks (PostToolUse).

readonly EXIT_OK=0

usage() {
  cat <<'USAGE'
Usage: lint-on-edit.sh [-h|--help]   (reads the PostToolUse event JSON on stdin)

Runs the eval-authoring lint when the edited file is under a plugin's eval
directory. Report only: always exits 0, prints nothing when out of scope, and
does nothing if node is not available.

  -h, --help   Show this message and exit.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit "$EXIT_OK"
    ;;
esac

command -v node >/dev/null 2>&1 || exit "$EXIT_OK"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit "$EXIT_OK"
node "$here/../../scripts/ts/hook/lint-hook.ts" || true
exit "$EXIT_OK"
