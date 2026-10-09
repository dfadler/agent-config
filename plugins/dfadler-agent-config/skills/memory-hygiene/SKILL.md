---
name: memory-hygiene
description: |
  Supplementary conventions for Claude Code's built-in auto-memory system:
  topic-key naming (`family/description` slugs), supersedes/superseded-by
  markers when correcting stale memories, and a session-close wrap-up habit.
  Load when writing, reviewing, or consolidating memory files, or when
  MEMORY.md approaches its 200-line cap.
license: MIT
metadata:
  version: "1.0.0"
---

# Memory hygiene

Supplementary guidance for Claude Code's built-in auto-memory system
(`user`/`feedback`/`project`/`reference` files under
`~/.claude/projects/.../memory/`, indexed by `MEMORY.md`). Adapted from
[Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram)'s
design — reimplemented as plain conventions since the built-in system covers
the actual need (single agent, small number of projects).

## Topic-key naming

Give each memory's `name:` slug a stable `family/description` shape:
lowercase kebab-case, two segments, e.g. `architecture/auth-model`,
`bug/nil-panic-in-user-list`, `decision/database-choice`.

Anti-patterns: no camelCase, no spaces or underscores, no more than one `/`,
nothing session- or date-specific (`bug/fix-from-tuesday`). Name the topic,
not the event, so the slug stays stable as the memory is updated.

Before creating a new file, grep the family prefix in `MEMORY.md` — an
existing memory in the same family may already cover it.

## Supersedes / superseded-by

When a memory turns out to be wrong or outdated, don't silently delete and
replace it. Keep the old file and add a one-line marker:

- On the outdated file, add near the top: `**Superseded by:** [[new-name]]`
- On the new file, add: `**Supersedes:** [[old-name]]`

Uses the same `[[name]]` linking already defined in the base memory
instructions. If the old memory is simply gone (not superseded, just wrong),
delete it and remove its `MEMORY.md` line — the marker is only for
"this is the corrected version of that."

## Session-close habit

Before wrapping up a session that produced anything durable, do one pass:
what was the goal, what was discovered, what got done, what's the next step.
Write or update a memory only for the parts that will matter in a future
session — skip what the diff, commit messages, or issue already record.

## Revisit-engram trigger

`MEMORY.md` caps at 200 lines. If it approaches ~160 lines (~80%), that's
the signal to reopen the engram evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273) — a
pull-based store (engram, Cognee) solves the indexing/retrieval problem
structurally. Check this during any memory review pass.
