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

Slug anti-patterns (adapted from engram's `topic_key` rules): no camelCase or
uppercase, no spaces or underscores, no more than one `/` (two segments max), and
nothing session- or date-specific (`bug/fix-from-tuesday`) — name the topic, not the
event, so the slug stays stable as the memory is updated. Keep each segment short
(a few words); if it needs a sentence, that belongs in `description:`.

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
unlike engram, which enforces this via a hook. The right mechanism here is a `Stop`
hook, not `SessionEnd`: `SessionEnd` fires after the session has already terminated,
can't block anything, and its output is shown to the user only, never added to
Claude's context, so Claude has no way to act on it. `Stop` fires while Claude can
still act — it can block (exit code 2 or `decision: "block"`) to keep the
conversation going, and its `additionalContext` output does reach Claude. A project
or user `Stop` hook that reminds "write a memory update if anything durable happened
this turn, before it's lost" would close this gap without adopting engram. Not
implemented yet — evaluate as a follow-up if the manual habit of writing memories
mid-session (rather than at close) turns out to be lossy in practice.

Until then, make it a manual habit: before wrapping up a session that produced
anything durable, do one pass modeled on engram's session summary — what was the
goal, what was discovered, what got done, what's the next step — and write or update
a memory only for the parts that will matter in a future session (skip what the
diff, commit messages, or issue already record).

### Revisit-engram trigger

Claude Code caps auto memory at the first 200 lines / 25KB of `MEMORY.md`, loaded in
full every session. Topic files aren't auto-loaded — Claude reads one on demand with
its standard file tools once it knows which one it needs — but there's no automatic
or semantic retrieval across them: no query/search over memory content the way an
MCP-backed store provides, only what the index already points at or what a manual
grep turns up. If `MEMORY.md` itself approaches the cap (roughly 160 lines / 20KB,
~80%) rather than staying small and pruned — i.e. the number of distinct memories,
not any one topic file's size, becomes the bottleneck — that's the concrete signal
to reopen the engram evaluation in
[agent-config#273](https://github.com/dfadler/agent-config/issues/273), since a
pull-based store (engram, Cognee) solves that indexing/retrieval problem structurally.
Check this whenever doing a memory review pass (e.g. via the `consolidate-memory`
skill) rather than on a schedule.
