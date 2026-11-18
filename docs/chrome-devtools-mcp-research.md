# chrome-devtools-mcp and its `chrome-devtools-cli` skill

Research for [agent-config#1117](https://github.com/dfadler/agent-config/issues/1117).
Sources are the project's own repo and npm registry entry, read 2026-11-18 at
version 1.13.0 (Apache-2.0, published 2026-11-11). Nothing was installed or run.

## What it is

[ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)
is an MCP server plus a `chrome-devtools` CLI that drives a live Chrome via Puppeteer
([README](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/README.md)).
The CLI talks to a background daemon that keeps browser state between commands
([docs/cli.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/cli.md)).
The `chrome-devtools-cli` skill teaches an agent to call that CLI
([SKILL.md](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/skills/chrome-devtools-cli/SKILL.md)).
The repo ships six other skills (a11y, cookie, LCP, memory-leak debugging, and more).

## What it adds over `playwright-cli` / `screen-capture`

Per the [tool reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md):

| Capability | chrome-devtools | Here today |
|---|---|---|
| Performance traces and insights | `performance_start_trace`, `performance_analyze_insight` | none |
| Lighthouse | `lighthouse_audit` (in-session) | `screen-capture:lighthouse` (Lighthouse CLI, stores to vault) |
| Network and console inspection | `list_network_requests`, `list_console_messages` (source-mapped stacks) | playwright-cli can do both; not compared here |
| Heap snapshots (14 tools) | yes | none |
| Network mocks, emulation, screencast | yes | playwright-cli overlaps; not compared |

Real gap: performance traces and heap analysis. Everything else overlaps.

## Fit with `prefer-real-chrome.md` and the gateway

- The convention bans `claude-in-chrome` (extension) because it fails with the Easy CLI
  gateway. chrome-devtools-mcp is a different mechanism (a local Node process
  launching or attaching to Chrome), so that reason does not obviously apply. **Not
  tested.** Verify before relying on it.
- Like Playwright it uses a clean profile by default ("Isolated is enabled by default
  unless `--userDataDir` is provided"), so logins are not carried over either.
- Officially supports Google Chrome and Chrome for Testing only.

## Install safety

- Upstream's manual path (`npm i ...@latest -g`, then copy the skill) is a fetch-and-execute
  install under `fetch-execute-installs.md`: needs per-run permission, and `@latest`
  contradicts the pin-a-version advice. The npm package has no `install`/`postinstall`
  script at 1.13.0, which lowers but does not remove the risk.
- Data flow to know about, from the README: **usage statistics to Google are on by
  default** (opt out with `--no-usage-statistics`, or env `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS`);
  performance tools may send trace URLs to the CrUX API (`--no-performance-crux`); the
  server checks npm for updates (`CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS`).
- The CLI has unrestricted filesystem access by default; `--workspace` limits it.
- The server exposes all browser content to the agent, per the README disclaimer.

## Packaging (the issue's open question)

The issue's premise is partly out of date. Upstream ships a Claude Code plugin:
`/plugin marketplace add ChromeDevTools/chrome-devtools-mcp`, then
`/plugin install chrome-devtools-mcp@chrome-devtools-plugins`. Its `plugin.json`
declares the MCP server pinned to the exact version
(`npx --prefix ${CLAUDE_PLUGIN_DATA} chrome-devtools-mcp@1.13.0`) and includes all
skills. So no copy into `~/.claude/skills/` and no hand-written wrapper plugin is needed.
The pin is still an `npx` fetch, so it needs the same explicit yes, once per
version. The README also warns skills must be refreshed whenever the server updates;
a plugin install avoids that drift.

## Recommendation

**Document as an optional alternative; do not adopt into this repo's plugins.**

- Upstream already is a plugin, so vendoring a copy here would only create drift.
- Playwright stays the default. Reach for chrome-devtools only for performance
  traces or heap analysis, which nothing here covers.
- If the owner wants it: install upstream's plugin on that machine, accept the
  pinned `npx` fetch explicitly, and opt out of usage statistics.

## Open for the owner

1. Is the performance-trace gap worth a second browser stack? (No current need found.)
2. If yes, a short paragraph in `prefer-real-chrome.md` pointing at the upstream plugin.
3. A gateway smoke test (one `list_pages` through the plugin) before relying on it.
