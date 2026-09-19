# Memory tooling alternatives to engram

Summary of the alternatives survey done for
[agent-config#273](https://github.com/dfadler/agent-config/issues/273), which evaluates
[Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram) against
this repo's own Claude Code auto-memory conventions. The full research notes — every
capability claim cited to its project's own repo/docs, not secondhand summaries — are
posted in full as
[a comment on that issue](https://github.com/dfadler/agent-config/issues/273#issuecomment-5742307735)
rather than duplicated here.

## Candidates compared

mem0 (+ self-hosted server), Zep (Memory MCP Server + Graphiti), Letta/Letta Code,
Cognee (`cognee-mcp`), Supermemory, and the official MCP reference memory server, each
scored against engram on: agent-agnostic MCP support, multi-project memory, a free
self-hosted option, license, and maturity (stars/last release).

| Candidate | Native MCP | Multi-project | Free self-host | License |
|---|---|---|---|---|
| **engram** | ✅ | ✅ automatic (cwd/env project detection) | ✅ single binary | MIT |
| mem0 | ⚠️ bridge-only now (native OpenMemory MCP sunset ~2026-07-29) | tenant-style (`user_id`), not project-aware | ✅ Docker + Postgres | Apache-2.0 |
| Zep | ✅ | ✅ | ❌ paid Enterprise/BYOC only (Graphiti core is free but lacks the MCP layer) | Apache-2.0 / commercial |
| Letta | ❌ wrong direction — consumes MCP, doesn't serve it | manual env-var workaround | ✅ | Apache-2.0 |
| Cognee | ✅ | ✅ but client-scoped, not filesystem-scoped | ✅ Direct Mode | Apache-2.0 |
| Supermemory | ✅ | ⚠️ manual `containerTag` | ✅ self-hosted binary | MIT |

## Bottom line

engram was the clearest fit at the time of this survey — the only candidate combining
native MCP and automatic multi-project detection as a core feature, with the broadest
coding-agent coverage. Cognee was the strongest second choice. See the issue for the
full reasoning, including how the requirements shifted (cross-agent support turned out
not to be needed) and the resulting decision to stay on the built-in memory system for
now.
