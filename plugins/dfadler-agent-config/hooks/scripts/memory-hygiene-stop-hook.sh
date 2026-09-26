#!/usr/bin/env bash
set -uo pipefail

# Stop hook: reminds Claude to write a memory update before ending a turn
# that leaves uncommitted git changes behind — the session-close habit
# documented in claude/conventions/memory-hygiene.md.
#
# Off by default — a project or session must opt in via the MEMORY_HYGIENE_REMINDER
# env var (1/true/yes/on to enable). A project can set this for every session by
# adding it to .claude/settings.json's own "env" key (a real Claude Code settings
# field — unlike a bespoke top-level settings.json key, which the CLI's own
# settings validation rejects as "Unrecognized field"):
#   { "env": { "MEMORY_HYGIENE_REMINDER": "on" } }
#
# `Stop` fires once per TURN, not once per session
# (https://code.claude.com/docs/en/hooks#stop) — a naive "always remind"
# hook would nag on nearly every turn. To stay low-noise this hook throttles
# itself to at most one reminder per session, via a marker file keyed on
# session_id, and only fires when the repo has uncommitted changes.
#
# ponytail: "uncommitted changes exist" is a cheap, imperfect stand-in for
# "durable work happened and isn't captured yet" — it misses a turn that
# already committed everything, and once the marker is set it won't re-fire
# even if more durable work follows later in the same session. Upgrade path:
# check git reflog for commits made since session start if this proves
# insufficient in practice.

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

stop_hook_active="$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)"
[ "$stop_hook_active" = "true" ] && exit 0

cwd="$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)"
session_id="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null | tr -cd 'A-Za-z0-9_-')"
[ -n "$cwd" ] && [ -n "$session_id" ] || exit 0

case "${MEMORY_HYGIENE_REMINDER:-}" in
  1 | true | yes | on) : ;; # explicit opt-in, fall through
  *) exit 0 ;;              # unset, or any other value (0/false/no/off) -> off
esac

# At most one reminder per session.
marker_dir="${TMPDIR:-/tmp}/agent-config-memory-hygiene"
mkdir -p "$marker_dir" 2>/dev/null || exit 0
marker="$marker_dir/$session_id"
[ -e "$marker" ] && exit 0

git -C "$cwd" rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
[ -n "$(git -C "$cwd" status --porcelain 2>/dev/null)" ] || exit 0

: >"$marker" 2>/dev/null || true

jq -n '{
  hookSpecificOutput: {
    hookEventName: "Stop",
    decision: "block",
    reason: "Uncommitted changes exist and no memory update has been noted yet this session.",
    additionalContext: "Before finishing: if anything durable happened this session (a decision, a fix, a gotcha worth remembering), write or update a memory now, per claude/conventions/memory-hygiene.md. Skip this if nothing durable happened."
  }
}'
