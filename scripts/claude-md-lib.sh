#!/usr/bin/env bash
# sourced-only
# Shared constants for the managed section setup.sh writes into ~/.claude/CLAUDE.md
# and teardown.sh strips back out. Sourced by both so the markers never drift apart.

# shellcheck disable=SC2034  # used by callers that source this file
MANAGED_BEGIN="# >>> agent-config managed begin <<<"
# shellcheck disable=SC2034
MANAGED_END="# >>> agent-config managed end <<<"
