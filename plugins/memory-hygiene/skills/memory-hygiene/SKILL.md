---
name: memory-hygiene
description: |
  Naming, staleness, and conflict conventions for Claude Code's auto-memory files
  (`MEMORY.md` and the topic files it indexes). Use when writing, updating, or
  pruning a memory, or doing a memory review pass.
metadata:
  version: "1.0.0"
---

# Memory hygiene

## Contract

- **Input:** a memory about to be written, updated, superseded, or reviewed.
- **Output:** a memory with a stable `family/description` name, supersession markers
  where it corrects an older one, and a flag when `MEMORY.md` nears its cap.
- **Does not:** decide what is worth remembering.

Supplementary guidance for Claude Code's built-in auto-memory system (the
`user`/`feedback`/`project`/`reference` files under `~/.claude/projects/.../memory/`,
indexed by `MEMORY.md`). Adapted from
[Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram)'s
design (evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273)) as plain
conventions rather than adopting engram itself.

## Topic-key style names

Give each memory's `name:` slug a stable `family/description` shape: lowercase
kebab-case, two segments, e.g. `architecture/auth-model`, `bug/nil-panic-in-user-list`,
`decision/database-choice`. Grep the family prefix in `MEMORY.md` before creating a new
file, so evolving topics land in one file instead of scattering across near-duplicates.

Anti-patterns: no camelCase or uppercase, no spaces or underscores, no more than one
`/`, and nothing session- or date-specific (`bug/fix-from-tuesday`). Name the topic,
not the event. Keep each segment short; a sentence belongs in `description:`.

## Supersedes / superseded-by

When a memory turns out to be wrong or outdated, don't silently delete and replace
it. Keep the old file and add a one-line marker so the correction is visible in
context, not just in git history:

- On the outdated file, near the top: `**Superseded by:** [[new-name]]`
- On the new file: `**Supersedes:** [[old-name]]`

If the old memory is simply wrong (not superseded), delete the file and remove its
`MEMORY.md` line as usual.

## Session-close habit

The built-in system has no prompt to write a wrap-up memory before a session ends.
The mechanism is the `Stop` hook shipped in this plugin (`hooks/hooks.json`), not
`SessionEnd`: `SessionEnd` fires after the session has terminated and its output never
reaches Claude, while `Stop` can block and its `additionalContext` reaches Claude. It
throttles to at most one reminder per session, only when `git status` shows
uncommitted changes, and is opt-in with `MEMORY_HYGIENE_REMINDER=on`.

Without the hook, do one pass before wrapping up a session that produced anything
durable: goal, what was discovered, what got done, next step. Write or update a memory
only for what will matter in a future session (skip what the diff, commits, or issue
already record).

## Revisit-engram trigger

Auto memory loads only the first 200 lines / 25KB of `MEMORY.md` every session. Topic
files are read on demand, with no semantic retrieval across them. If `MEMORY.md`
approaches the cap (roughly 160 lines / 20KB), the number of distinct memories is the
bottleneck: reopen the engram evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273). Check this
during any memory review pass (e.g. the `consolidate-memory` skill), not on a schedule.
