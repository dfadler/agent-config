## Memory hygiene: naming, staleness, and conflicts

Supplementary guidance for Claude Code's built-in auto-memory system (the
`user`/`feedback`/`project`/`reference` files under `~/.claude/projects/.../memory/`,
indexed by `MEMORY.md`). These patterns are adapted from
[Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram)'s
design — see the evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273) — reimplemented
as plain conventions instead of adopting engram itself, since the built-in system
already covers the actual need (single agent, small number of projects).

### Topic-key style names

Give each memory's `name:` slug a stable `family/description` shape instead of an
ad hoc one, mirroring engram's `topic_key` convention: lowercase kebab-case, two
segments, e.g. `architecture/auth-model`, `bug/nil-panic-in-user-list`,
`decision/database-choice`. This makes "check for an existing memory before writing
a new one" (already required by the base memory instructions) actually checkable —
grep the family prefix in `MEMORY.md` before creating a new file — and keeps
evolving topics landing in one file instead of scattering across near-duplicates.

### Supersedes / superseded-by

When a memory turns out to be wrong or outdated, don't silently delete and replace
it. Keep the old file and add a one-line marker so the correction is visible in
context, not just in git history:

- On the outdated file, add near the top: `**Superseded by:** [[new-name]]`
- On the new file, add: `**Supersedes:** [[old-name]]`

This uses the same `[[name]]` linking the base memory instructions already define —
no new syntax, no new tooling. If the old memory is simply gone (not superseded,
just wrong), delete the file and remove its `MEMORY.md` line as usual; the marker
is only for "this is the corrected version of that."

### Session-close habit

The built-in system has no prompt to write a wrap-up memory before a session ends —
unlike engram, which enforces this via a `SessionEnd` hook. Claude Code's hook
system supports `SessionEnd` generally (it isn't an engram-specific mechanism); a
project or user `SessionEnd` hook that reminds "write a memory update if anything
durable happened this session, before it's lost" would close this gap without
adopting engram. Not implemented yet — evaluate as a follow-up if the manual habit
of writing memories mid-session (rather than at close) turns out to be lossy in
practice.

### Revisit-engram trigger

Claude Code caps auto memory at the first 200 lines / 25KB of `MEMORY.md`, loaded
in full every session — there's no on-demand search. If `MEMORY.md` approaches that
cap (roughly 160 lines / 20KB, ~80%) rather than staying small and pruned, that's
the concrete signal to reopen the engram evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273), since a
pull-based store (engram, Cognee) solves the scale problem that a flat always-loaded
index structurally cannot. Check this whenever doing a memory review pass (e.g. via
the `consolidate-memory` skill) rather than on a schedule.
