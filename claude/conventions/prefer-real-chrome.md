## Browser tasks: use the user's real Chrome

For any browser task (web research, logged-in sites, previewing a page),
prefer the `mcp__claude-in-chrome__*` tools (the user's real Chrome, with
their logins and extensions) over the desktop app's built-in Browser pane
(`mcp__Claude_Browser__*`, a clean profile with no logins). Fall back to the
pane only if the Chrome tools are unavailable or the user asks for it.

This is advice, not a gate: the desktop app's own instructions can outrank
it. To enforce it, add `"mcp__Claude_Browser__*"` to `permissions.deny` in
`~/.claude/settings.json` (a bare-name or glob deny removes the tools from
context; [permissions docs](https://code.claude.com/docs/en/permissions)).
That also disables the pane's dev-server preview. Or turn the Browser off in
the desktop app's Settings → Claude Code
([desktop docs](https://code.claude.com/docs/en/desktop#preview-your-app)).
