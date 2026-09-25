---
name: query
description: |
  Search the second-brain Obsidian vault for notes relevant to a topic or
  question, and answer from what's found. Use when the user asks "what do I
  know about X", "check my second brain for X", "search my notes for X", or
  wants an answer grounded in their own vault rather than general knowledge.
metadata:
  version: "0.1.0"
---

# Query the vault

Search the vault for notes relevant to the question, then answer from what
those notes actually say — don't fall back to general knowledge and present
it as if it came from the vault.

## 1. Resolve the vault path

Resolution order (no hardcoded path, ever):

1. `SECOND_BRAIN_VAULT_PATH` env var.
2. `secondBrain.vaultPath` in `~/.claude/settings.json`.

If `second-brain:config` is installed in this environment, prefer delegating
vault-path resolution to it — it may add a vault-local config layer on top of
this order. Otherwise resolve directly as above.

If neither source is set, stop and tell the user: no vault path configured;
set `SECOND_BRAIN_VAULT_PATH` or add `secondBrain.vaultPath` to
`~/.claude/settings.json`. Do not guess a path.

## 2. Search

- Search `.md` files under `<vault>` for the query terms — filename, headings,
  and body text — and by tag if the query names one (`#tag` or frontmatter
  `tags:`).
- Prefer a small number of well-matched notes over an exhaustive list; widen
  the search only if the first pass finds nothing.

## 3. Answer

- Cite each note used by its path relative to the vault root.
- If multiple notes conflict or overlap, say so rather than silently picking
  one.
- If nothing relevant is found, say so plainly — don't answer from general
  knowledge instead.
