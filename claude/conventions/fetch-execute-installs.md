## Fetch-and-execute installs: always ask first

A command that fetches code from a registry or URL and runs it in the same
step (`npx <pkg>@latest`, `curl <url> | sh`, etc., but not an ordinary `npm
install`/`pip install` against a project's own lockfile) needs explicit,
per-run permission before it runs, even under a broad Bash allow-rule — see
the `dfadler-agent-config:fetch-execute-guide` skill for the exact
scope and procedure.

