---
name: issue-tracker
description: |
  Which issue tracker a repo uses (GitHub Issues or Jira) and how to file in it. Use
  when creating, referencing, or commenting on an issue, or when unsure whether to use
  `gh issue` or a Jira connector.
metadata:
  version: "1.0.0"
---

# Issue tracker

## Contract

- **Input:** a task that creates or references an issue.
- **Output:** the right tracker and tool chosen for the repo.
- **Does not:** publish anything; confirm with `gh-publish-guide` before posting.

If the project's `CLAUDE.md` has an `## Issue tracker` section, use it: it is
the single source of truth. The standard declaration format:

```
## Issue tracker
GitHub Issues          # personal/User repos
```
```
## Issue tracker
Jira project: KEY      # org repos using Jira
```

**If no section is present**, fall back to `gh repo view --json owner`
(`.owner.type`): `User` means GitHub Issues; `Organization` means look up the org in
`~/.claude/CLAUDE.md` (private).

- **GitHub Issues**: use the `gh` CLI. Label new issues: check `gh label list`
  first; create a label if nothing fits.
- **Jira**: use the Jira MCP connector, never `gh issue`.
