## Issue tracker

If the project's `CLAUDE.md` has an `## Issue tracker` section, use it — it is
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
(`.owner.type`): `User` → GitHub Issues; `Organization` → look up the org in
`~/.claude/CLAUDE.md` (private).

- **GitHub Issues** — use the `gh` CLI. Label new issues: check `gh label list`
  first; create a label if nothing fits.
- **Jira** — use the Jira MCP connector — never `gh issue`.

