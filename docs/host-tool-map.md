# Host tool map: Claude Code Desktop vs T3 Code

A handoff or skill written in one host can name a tool the other host does not
have (a handoff once told a T3 Code agent to call `mcp__ccd_session__start_session`).
Skills here should describe the job ("spawn a worktree subagent"), not the tool.
When a handoff names a tool that is missing, use this map to find the equivalent
instead of failing.

## Detect the host

Look at the tool list, not at assumptions:

- `mcp__t3-code__*` tools present: T3 Code.
- `mcp__ccd_session_mgmt__*` tools present: Claude Code Desktop.

## Map

| Job | Claude Code Desktop | T3 Code |
| --- | --- | --- |
| Spawn a child session | unverified (a handoff named `mcp__ccd_session__start_session`; no file in this repo confirms it) | `mcp__t3-code__delegate_task` (call `orchestrator_capabilities` once per thread first) |
| Child in its own checkout | unverified | `delegate_task` with `isolation:"worktree"` |
| List sessions | `mcp__ccd_session_mgmt__list_sessions` (used by `pr-session-sweep`) | `mcp__t3-code__t3_thread_list` |
| Read a session | unverified | `mcp__t3-code__t3_thread_read` |
| Message a session | unverified | `mcp__t3-code__t3_thread_send` |
| Stop a delegated run | unverified | `mcp__t3-code__task_cancel` |
| Context usage | `mcp__ccd_session_mgmt__get_usage` (used by `context-preservation`) | none found |

T3 tools are deferred: load a schema with `ToolSearch` (`select:<name>`) before
calling it.

"unverified" means no file in this repo or tool list in a T3 session confirms the
name. Replace each cell after checking a Claude Code Desktop session's tool list.

## Sources in this repo

- `plugins/github-pr/skills/pr-session-sweep/SKILL.md`: `list_sessions`.
- `claude/conventions/context-preservation.md`: `get_usage`.
