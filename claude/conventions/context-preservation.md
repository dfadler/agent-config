## Context preservation: delegate large-output work

Large tool output in the main context crowds out the work that needs it. Before a
task likely to produce more than ~50 lines of tool output or ~3 file reads, decide
where it runs:

- **Delegate it to a sub-agent** when the expected output exceeds that size, or when
  context is already at 40% or more of the window. Ask for a compact result, not raw
  output.
- **Measure, don't guess.** In Claude Code Desktop, `mcp__ccd_session_mgmt__get_usage`
  reports context percent used. Elsewhere (CLI, Bedrock, Vertex), treat roughly 15
  substantial turns as the 40% mark.
- **Override the threshold** with a plain line in `CLAUDE.personal.md`, e.g.
  `delegation threshold: 50%`.

Small, bounded work (a single-file edit, a quick lookup) stays in the main context.
For routing between a direct answer, one `Agent` call, and a `Workflow`, and for the
compact result format, load the `subagent-orchestration` skill.
