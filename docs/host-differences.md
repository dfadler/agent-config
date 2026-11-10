# Host differences: Claude Code Desktop vs T3 Code

Both hosts run the same Claude Code harness, so CLAUDE.md, conventions, skills and
hooks load identically. Only the host-provided MCP tools differ. Skills and conventions
name a capability and point here; add a row when a new host-specific tool is needed.

Tool names below come from each host's own tool listing in a live session, not from
published docs. T3 tools are deferred: load a schema with `ToolSearch` before calling.

| Capability | Claude Code Desktop | T3 Code |
|---|---|---|
| List sibling sessions | `mcp__ccd_session_mgmt__list_sessions` | `t3_thread_list`, `t3_thread_read` |
| Context percent used | `mcp__ccd_session_mgmt__get_usage` | none known; use the ~15-turn estimate |
| Start a separate session | `mcp__ccd_session__start_session` | `delegate_task` (`isolation: "worktree"` for its own checkout) |
| Open a local page | `mcp__Claude_Browser__navigate` | `html_preview` / `html_render`, or `preview_open` |
| Link or watch a PR | none | `link_pull_request`, `watch_pull_request` |

If a listed tool is not in your tool list, you are on the other host: use the other
column, or the documented fallback in the skill. Do not report the capability as missing.
