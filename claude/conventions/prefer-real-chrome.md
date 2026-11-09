## Browser tasks: use Playwright

For any browser task (web research, previewing a page, driving a UI), use
Playwright rather than the Claude in Chrome extension, which does not work
with the Easy CLI gateway enabled. Use the `playwright:playwright` skill for
scripted runs and recordings, and the `playwright-cli` skill for interactive
sessions. Run the project's installed Playwright (for example via
`pnpm exec playwright` or `node`); do not fetch it with `npx <pkg>@latest`
(see `fetch-execute-installs.md`).

Playwright launches a clean browser profile. It does not carry the user's
logins or extensions, so for a logged-in site either ask the user to supply a
`storageState` file or ask them to do the step themselves.

Do not use the desktop app's built-in Browser pane (`mcp__Claude_Browser__*`)
for these tasks either. It is a clean profile with no logins, and the
dev-server preview it provides is separate from this convention.

This is advice, not a gate. To enforce it, add `"mcp__Claude_Browser__*"` and
`"mcp__claude-in-chrome__*"` to `permissions.deny` in `~/.claude/settings.json`
(a bare-name or glob deny removes the tools from context;
[permissions docs](https://code.claude.com/docs/en/permissions)).
