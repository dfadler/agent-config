## Fetch-and-execute installs: always ask first

A command that fetches code from a registry or URL and runs it in the same
step (`npx <pkg>@latest`, `pnpm dlx`/`bunx`/`uvx`, `curl <url> | sh`, `go run
<url>`) needs explicit, per-run permission before it runs — even under a broad
Bash allow-rule. An ordinary `npm install`/`pip install` against a project's own
lockfile is not covered. Permission counts only when it is:

- **Explicit** — the user said yes to this command, not to the broader task.
- **Request-scoped** — approval for a different tool earlier doesn't carry over.
- **Specific** — show the full command (package/URL included) before asking.

If the user declines, hand them the command to run themselves. The optional
`fetch-execute-guide` plugin ships a fuller skill with the exact scope and
procedure; this rule holds without it.
