---
name: capture
description: |
  Capture a quick note into the second-brain Obsidian vault's inbox, timestamped
  and unfiled, without deciding where it ultimately belongs. Use when the user
  says "capture this", "add this to my second brain", "note this down", "jot
  this down", or hands over a thought, link, or snippet to save for later
  triage.
metadata:
  version: "0.1.0"
---

# Capture a note

Append a quick, timestamped note to the vault's inbox. Capture is a landing
zone, not organization — don't file, tag beyond what's given, or summarize;
save what the user gave you.

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

## 2. Write the note

- Target file: `<vault>/Inbox/<YYYY-MM-DD-HHmmss>-<slug>.md`, where `<slug>` is
  a short kebab-case slug from the first few words of the captured content.
- Frontmatter:
  ```yaml
  ---
  created: <ISO 8601 timestamp>
  source: capture
  ---
  ```
- Body: the captured content verbatim (light cleanup of stray whitespace only
  — no rewriting, no added structure).
- Create the `Inbox/` directory if it doesn't exist yet.

## 3. Confirm

Tell the user the note's path relative to the vault root and a one-line
summary of what was captured. Don't open, list, or otherwise read back the
rest of the inbox.
