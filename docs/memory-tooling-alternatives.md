# Memory tooling alternatives to engram

Research for issue [#273](https://github.com/dfadler/agent-config/issues/273), which is
evaluating [Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram)
as a possible replacement or complement to this repo's own hand-rolled Claude memory
convention (`~/.claude/projects/.../memory/`, typed markdown, manual `MEMORY.md` index —
per-Claude-install, not shared across other agent tools or automatically across projects).

The actual need: memory that persists and is shareable across **both** multiple AI coding
agents (Claude Code, and likely others) **and** multiple separate project repos, ideally
self-hosted and git-config-repo-friendly. This doc surveys real alternatives against that
need, sourced from each project's own repo/docs rather than secondhand summaries — every
capability claim below cites the primary source it came from, and anywhere a primary
source didn't answer a question, that's called out explicitly instead of guessed.

Traction numbers (stars, forks, release dates) were pulled via `gh api repos/<owner>/<repo>`
on 2026-09-19, not eyeballed from repo homepages — repo READMEs are otherwise the primary
source for everything else unless a different URL is cited inline.

## engram (baseline)

[Gentleman-Programming/engram](https://github.com/Gentleman-Programming/engram) — "Persistent
memory for AI coding agents... One brain. Local or cloud. Agent-agnostic, single binary, zero
dependencies," per its [README](https://github.com/Gentleman-Programming/engram/blob/main/README.md).

- **Storage**: SQLite + FTS5, local, at `~/.engram/engram.db`. Single Go binary, no Node/Python/Docker.
- **MCP**: native stdio MCP server — the primary interface, alongside CLI/HTTP/TUI.
- **Agent compatibility**: Claude Code, OpenCode, Gemini CLI, Codex, VS Code (Copilot),
  Antigravity, Cursor, Windsurf, Pi, Qwen Code, Kiro, Kilo Code — via per-agent
  `engram setup <agent>` commands.
- **Multi-project**: native and automatic — current project resolved via explicit selection,
  the `ENGRAM_PROJECT` env var, or working-directory detection; a `--all` flag reads across
  every project. This is engram's standout feature relative to every other candidate below.
- **Self-hosted**: fully free — MIT license, single local binary, no account needed. An
  optional "Engram Cloud" adds project-scoped replication and browser visibility; the README
  doesn't publish its pricing.
- **License**: MIT (code); the README notes "Engram" names/logos are trademarked separately.
- **Maturity**: 6,711 stars, 696 forks, 111 open issues, latest release `v2.0.0`
  (2026-09-18), last push 2026-09-19 — created 2026-02-16, so young but very actively worked.

## mem0 (+ self-hosted server; OpenMemory sunset)

[mem0ai/mem0](https://github.com/mem0ai/mem0) — "an intelligent memory layer" for AI agents,
per its [README](https://raw.githubusercontent.com/mem0ai/mem0/main/README.md), with
multi-level (user/session/agent) memory.

- **Storage**: self-hosted server uses Postgres + pgvector as the vector store, per
  [docs.mem0.ai/open-source/overview](https://docs.mem0.ai/open-source/overview); the
  library form supports pluggable vector-DB backends.
- **MCP**: mem0's *native* local MCP path was **OpenMemory** — a first-party MCP server
  exposing `add_memories`/`search_memory`/`list_memories` tools, announced in
  [mem0.ai/blog/introducing-openmemory-mcp](https://mem0.ai/blog/introducing-openmemory-mcp).
  That directory no longer exists in the repo — confirmed directly by listing
  `mem0ai/mem0`'s root via `gh api repos/mem0ai/mem0/contents/`, which has no `openmemory`
  entry (only `server`, `cli`, `mem0`, `mem0-ts`, etc.). Community sources put the deletion
  at 2026-07-29 with mem0's own docs now pointing self-hosted users at the unified
  self-hosted server instead. As of today, mem0's officially documented native MCP support is
  **"Mem0 Platform MCP,"** i.e. MCP for the *hosted cloud* platform; self-hosted MCP access
  now depends on an official example wiring (`examples/claude-code-codex-self-hosted/` in the
  mem0ai/mem0 repo) or third-party bridges (e.g. `elvismdev/mem0-mcp-selfhosted`) rather than
  a first-class shipped server. **Net: bridge/example-only for self-hosted MCP today, not
  native**, contra the OpenMemory blog post which is now stale.
- **Agent compatibility**: Claude Code, Codex, Cursor, Windsurf, OpenCode, OpenClaw — per the
  mem0ai/mem0 README's "skills" section — plus any MCP client via the hosted Platform.
- **Multi-project**: multi-user/multi-agent scoping via `user_id`/`agent_id` API filters —
  tenant-style scoping, not automatic per-repo project detection like engram's.
- **Self-hosted**: free — Docker stack, Apache-2.0, you run Postgres+pgvector yourself. The
  managed "Mem0 Platform" is the paid option.
- **License**: Apache-2.0.
- **Maturity**: 65,632 stars, 7,704 forks, 757 open issues, last push 2026-09-19, latest
  tagged release `openclaw-v1.2.0` (2026-09-18) — a huge, very active project overall
  (the release tag naming suggests a sub-component/integration release, not necessarily a
  core-library version bump).

## Zep (Memory MCP Server + Graphiti)

[Zep](https://www.getzep.com/) positions itself as "agent memory at enterprise scale." Its
**Memory MCP Server** product connects MCP clients to a user's Zep memory graph, per
[help.getzep.com/memory-mcp-server](https://help.getzep.com/memory-mcp-server).

- **MCP**: native — Zep ships and documents this as its own product, with identity-provider
  auth (Google Workspace or enterprise IdP) gating access per user.
- **Agent compatibility**: explicitly documented — Claude, ChatGPT, Claude Code, Codex,
  Cursor, and other MCP clients.
- **Multi-project**: native and strong — "each connected user can always read their own user
  graph," and when a user has access to multiple projects they get a project chooser; one
  MCP endpoint URL serves every client and every project.
- **Self-hosted**: **not free.** The `getzep/zep` GitHub repo itself states plainly it is
  "**not** Zep's product or service" (confirmed via its own
  [README](https://raw.githubusercontent.com/getzep/zep/main/README.md)) — it's SDK examples;
  its Community Edition is deprecated. The actual open-source engine behind Zep is
  [Graphiti](https://github.com/getzep/graphiti) ("the open-source temporal knowledge graph
  framework that powers Zep," per the same README), but Graphiti alone does not include the
  Memory MCP Server or identity-provider layer. Deploying that full layer in your own
  cloud/VPC (BYOC) is an Enterprise-plan feature — e.g. custom OIDC "requires the Enterprise
  plan" per the Memory MCP Server docs, and BYOC/VPC deployment is listed under
  [getzep.com/enterprise](https://www.getzep.com/enterprise/). So: self-hosting the *whole*
  product (with MCP) is paid; only the underlying graph engine is free.
- **License**: `getzep/zep` repo and `getzep/graphiti` are both Apache-2.0; Zep Cloud/Enterprise
  itself is commercial.
- **Maturity**: `getzep/zep` 4,920 stars; `getzep/graphiti` 31,003 stars, latest release
  `v0.30.2` (2026-09-08), last push 2026-09-19 — Graphiti itself is very active.

## Letta (formerly MemGPT) / Letta Code

[letta-ai/letta](https://github.com/letta-ai/letta) — a "platform for stateful agents" built
around self-editing memory blocks (core / recall / archival tiers). **Letta Code**
([letta-ai/letta-code](https://github.com/letta-ai/letta-code)) is its Apache-2.0 coding-agent
harness (CLI/desktop/MCP-compatible), launched 2026-04-06.

- **MCP**: Letta's own docs describe MCP support as **client-only** — per
  [docs.letta.com/guides/mcp/overview](https://docs.letta.com/guides/mcp/overview/), Letta
  agents call out to *external* MCP tool servers; there's no documented first-party path for
  Letta to expose itself as an MCP memory server that Claude Code or another agent pulls
  from. That capability exists only through third-party community bridges — e.g.
  `oculairmedia/Letta-MCP-server` and `dhrubajyoti-giri/letta-mcp` — not through Letta's own
  documented product surface. **This is the reverse direction from what the user needs**
  (an agent-agnostic memory *server*, not a Letta-specific agent that *consumes* MCP tools).
- **Storage**: self-hosted local backend defaults to `~/.letta/lc-local-backend`, with
  per-agent memory under `memfs/<agent-id>/memory` (per Letta Code's self-hosting docs);
  the broader Letta server's default backend for hosted/API use wasn't independently
  re-verified beyond that.
- **Multi-project**: no automatic detection — Letta Code docs mention manually isolating
  state per project via the `LETTA_LOCAL_BACKEND_DIR` env var, a workaround rather than a
  feature.
- **Self-hosted**: free — Apache-2.0, local App Server option, no Letta account required.
- **License**: Apache-2.0 (both repos).
- **Maturity**: `letta-ai/letta` 24,796 stars, latest tagged release `0.16.8` (2026-05-14 —
  ~4 months old), but pushed 2026-09-10 (commits ongoing); `letta-ai/letta-code` 3,379 stars,
  pushed 2026-09-19.

## Cognee (cognee-mcp)

[topoteretes/cognee](https://github.com/topoteretes/cognee) — "the open-source AI memory
platform for agents," a GraphRAG-style knowledge-graph memory engine that ships an official
`cognee-mcp` server, per its
[README](https://raw.githubusercontent.com/topoteretes/cognee/main/cognee-mcp/README.md).

- **Storage**: flexible — local by default (SQLite, LanceDB), optional graph DBs (Neo4j, AWS
  Neptune), optional cloud DBs (Postgres, Turso).
- **MCP**: native — `cognee-mcp` is a first-party server in the same monorepo, supporting
  stdio (default), SSE, and Streamable HTTP transports.
- **Agent compatibility**: documented for Claude CLI/Desktop, Cursor, Cline, Roo, via manual
  per-client JSON config.
- **Multi-project**: built in, but client-scoped rather than filesystem-scoped — "agent
  scoping" auto-creates per-client datasets (e.g. `cursor_vscode_memory`); can be disabled via
  `COGNEE_MCP_AGENT_SCOPED=false` to share memory across clients instead.
- **Self-hosted**: free for "Direct Mode" (local DBs, default, no external cost); an optional
  paid Cognee Cloud subscription exists for hosted mode.
- **License**: Apache-2.0.
- **Maturity**: 30,835 stars, 481 open issues, latest release `v1.6.0` (2026-09-18), last push
  2026-09-19 — very active.

## Supermemory

[Supermemory](https://supermemory.ai/) — "Memory API for the AI era," with two distinct MCP
surfaces documented at
[supermemory.ai/docs/agents-and-mcp](https://supermemory.ai/docs/agents-and-mcp): a Docs MCP
(lets a coding agent search Supermemory's own product docs) and a Memory MCP (actual
persistent cross-session memory).

- **Storage**: cloud-hosted by default (`api.supermemory.ai`); the self-hosted edition ships
  as a single self-contained binary with no Docker/DB to provision, or an enterprise
  Cloudflare Workers + Postgres deployment, per
  [supermemory.ai/docs/self-hosting/overview](https://supermemory.ai/docs/self-hosting/overview).
- **MCP**: native — first-party servers for both the docs and memory use cases.
- **Agent compatibility**: Cursor, Claude Code, Codex, OpenCode, VS Code, and "generic MCP
  clients" via an `mcp-remote` stdio proxy; plugins for OpenClaw and Hermes are also mentioned.
- **Multi-project**: via a required `containerTag` on every write/search call — "every write
  and every search MUST include `containerTag`" — effective isolation, but caller-supplied
  metadata rather than automatic cwd-based detection.
- **Self-hosted**: free and open source for the basic self-hosted binary — the self-hosting
  docs describe it as "free, open source... great for local development, air-gapped
  environments, and privacy-sensitive workloads." Managed connectors (Google Drive, Notion,
  Gmail, OneDrive) and enterprise infra remain paid/cloud-only.
- **License**: MIT.
- **Maturity**: 30,491 stars, 107 open issues, latest release `server-v0.0.8` (2026-08-17),
  last push 2026-09-18.

## MCP reference memory server (baseline floor, not a real candidate)

[modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)`/src/memory`
— the official MCP reference implementation's basic knowledge-graph memory server
(entities/relations/observations), published as `@modelcontextprotocol/server-memory` on npm.

- **Storage**: a single local JSONL file (`memory.jsonl` by default, path configurable via
  `MEMORY_FILE_PATH`), per its
  [README](https://raw.githubusercontent.com/modelcontextprotocol/servers/main/src/memory/README.md).
- **MCP**: native by definition — it *is* an MCP reference server, stdio transport.
- **Agent compatibility**: any MCP client; no coding-agent-specific setup story beyond the
  generic Claude Desktop config example.
- **Multi-project**: none — one flat file per configured path; would need manual
  per-project `MEMORY_FILE_PATH` wiring to approximate project scoping.
- **Self-hosted**: trivially, always — it's just a local process; no cloud option exists.
- **License**: MIT for this server specifically. Note the monorepo's overall
  [LICENSE](https://github.com/modelcontextprotocol/servers/blob/main/LICENSE) states the
  wider MCP project is "undergoing a licensing transition from the MIT License to the Apache
  License, Version 2.0" — new contributions default to Apache-2.0 unless already MIT and
  not yet relicensed.
- **Maturity**: judged at the whole-monorepo level since this one server has no separate
  stats — 90,461 stars, last push 2026-09-03, latest tag `2026.8.31`. Extremely high overall
  traffic, but this specific server is an intentionally minimal reference implementation, not
  an evolving product — a floor to compare against, not a real option for the user's need.

## Comparison table

| Candidate | MCP support (agent-agnostic) | Multi-project memory | Self-hosted option | License | Maturity (stars / latest release) |
|---|---|---|---|---|---|
| **engram** | Native | Native — cwd/env project detection, `--all` cross-project reads | Free (MIT, single binary) | MIT | 6.7k stars / `v2.0.0` (2026-09-18) |
| **mem0** (self-hosted server) | Bridge/example-only for self-hosted (native OpenMemory MCP sunset ~Jul 2026); native only via hosted Platform MCP | Multi-user/agent via `user_id`/`agent_id`, not project-detection | Free (Apache-2.0 Docker stack) | Apache-2.0 | 65.6k stars / actively released, `openclaw-v1.2.0` (2026-09-18) |
| **Zep** (Memory MCP Server) | Native | Native — multi-user + multi-project chooser | Paid only (Enterprise/BYOC); underlying Graphiti engine is free but lacks the MCP/identity layer | Apache-2.0 (Graphiti); Zep Cloud/Enterprise commercial | Zep repo 4.9k / Graphiti 31k stars, Graphiti `v0.30.2` (2026-09-08) |
| **Letta / Letta Code** | Client-only officially; server-exposure only via 3rd-party bridges | Manual (env var per project) | Free (Apache-2.0, local App Server) | Apache-2.0 | 24.8k stars (core, release stale since 2026-05-14) / 3.4k (Letta Code, fresh) |
| **Cognee** (cognee-mcp) | Native | Native, but client-scoped not filesystem-scoped | Free (Direct Mode, local DBs); paid Cognee Cloud optional | Apache-2.0 | 30.8k stars / `v1.6.0` (2026-09-18) |
| **Supermemory** | Native | Semi-native (`containerTag`, caller-supplied) | Free (self-hosted binary, MIT); paid cloud/connectors | MIT | 30.5k stars / `server-v0.0.8` (2026-08-17) |
| **MCP reference memory server** | Native (it's the reference impl) | None (single flat file) | Always free/local, no cloud option | MIT (this server) | part of 90k-star monorepo; server itself intentionally minimal |

## Recommendation

**engram** is the clearest fit for the actual need (cross-agent, cross-project, self-hosted,
git-config-repo-friendly): it's the only candidate with *both* native MCP *and* automatic
multi-project detection built in as a core feature rather than a bolt-on, ships as a single
free local binary with no infrastructure to run, and already documents setup for more coding
agents (8+, including Claude Code, Codex, Cursor, Windsurf) than any other candidate here. The
main open question is maturity — it's young (created 2026-02-16) — so a hands-on trial should
specifically probe whether its structured `topic_key`/What-Why-Where-Learned save format
actually beats this repo's own hand-rolled markdown conventions enough to justify the switch,
per issue #273's own next steps.

**Cognee** is the strongest second option: also native MCP and free to self-host in Direct
Mode, with a genuinely richer memory model (pluggable graph/vector backends) than engram's
SQLite+FTS5. Its multi-project story is weaker for this use case though — scoping is
per-client-tool (`cursor_vscode_memory`-style) rather than per-filesystem-project — and it's a
heavier stack (Python, optional graph DBs, more moving parts) versus engram's zero-dependency
binary, a worse match for "git-config-repo-friendly" simplicity.

Everything else has a disqualifying gap for this specific need: mem0 lost its native
self-hosted MCP path when OpenMemory was sunset, leaving only bridges/examples; Zep's
polished MCP + multi-project layer is Enterprise-paid, not free self-host; Letta's MCP support
runs the wrong direction (it consumes MCP tools rather than serving memory over MCP, natively)
and its multi-project support is a manual env-var workaround; the MCP reference memory server
is too minimal (one flat file, no multi-project) to be a real product, only a floor.
