---
name: issue-tracker
description: |
  Determine which issue tracker to use (GitHub Issues vs. Jira) and how to
  interact with it. Load when creating, referencing, or updating an issue.
  Resolution order: project CLAUDE.md → `gh repo view` owner type → org table
  in ~/.claude/CLAUDE.md. GitHub Issues: use `gh` CLI. Jira: use the Jira MCP
  connector — never `gh issue`.
license: MIT
metadata:
  version: "1.0.0"
---

# Issue tracker

## Resolution order

1. **Project `CLAUDE.md`** — if it has an `## Issue tracker` section, use it.
   That section is the single source of truth. Standard declarations:

   ```
   ## Issue tracker
   GitHub Issues
   ```
   ```
   ## Issue tracker
   Jira project: KEY
   ```

2. **`gh repo view --json owner`** (`.owner.type`) — if no section is present:
   - `User` → GitHub Issues
   - `Organization` → look up the org in `~/.claude/CLAUDE.md`

## GitHub Issues

Use the `gh` CLI. When creating a new issue, check `gh label list` first;
create a label if nothing fits.

## Jira

Use the Jira MCP connector. Never use `gh issue` for a Jira-tracked project.
The project key comes from the `## Issue tracker` section in `CLAUDE.md`.
