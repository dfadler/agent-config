## Browser tasks: use Playwright

For any browser task (web research, previewing a page, driving a UI), use
Playwright rather than the Claude in Chrome extension, which does not work
with the Easy CLI gateway enabled.

- **Interactive sessions:** the `playwright-cli` skill. Its CLI is a hard
  dependency: `scripts/check-companions.sh` (run by `setup.sh`) fails when
  `playwright-cli` is missing. Install it with `npm install -g @playwright/cli@latest`,
  or re-run `./setup.sh --install-deps`. The install stays opt-in; setup never
  installs it on a bare run.
- **Scripted runs and recordings:** the `playwright:playwright` skill, using the
  project's installed `playwright` package (for example via `pnpm exec playwright`
  or `node`). Do not fetch it with `npx <pkg>@latest` (see
  `fetch-execute-installs.md`).

Playwright launches a clean browser profile. It does not carry the user's
logins or extensions, so for a logged-in site either ask the user to supply a
`storageState` file or ask them to do the step themselves.

Do not use the desktop app's built-in Browser pane (`mcp__Claude_Browser__*`)
for these tasks either.

This is advice, not a gate. To enforce it, add `"mcp__Claude_Browser__*"` and
`"mcp__claude-in-chrome__*"` to `permissions.deny` in `~/.claude/settings.json`
(a bare-name or glob deny removes the tools from context;
[permissions docs](https://code.claude.com/docs/en/permissions)). **Warning:**
denying `mcp__Claude_Browser__*` also disables the desktop app's dev-server
preview, so only add it if you do not want that preview.
