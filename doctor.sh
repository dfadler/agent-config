#!/usr/bin/env bash
# Thin discoverability wrapper, alongside setup.sh/teardown.sh at the repo
# root. All detect/fix logic lives in scripts/check-companions.sh — this
# just forwards to it unchanged.
#
# Usage: ./doctor.sh [--install-deps] [--fix]

set -euo pipefail

REPO_ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$REPO_ROOT/scripts/check-companions.sh" "$@"
