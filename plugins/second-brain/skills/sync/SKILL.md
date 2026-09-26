---
name: sync
description: |
  Sync the second-brain Obsidian vault with its Slack canvas sources and fill
  in missing documentation page summaries. Use when the user wants to update
  vault notes from their Slack canvas origins — pulling in changes made to
  source canvases since the last sync while preserving locally-added context.
  Also refreshes any configured documentation index summaries for entries that
  lack one. Also runs on a weekly scheduled task. Trigger on phrases like
  "sync the vault", "update from Slack", "check for updates", "run the weekly
  sync", or "pull latest from Slack".
metadata:
  version: "0.1.0"
---

# Sync

Sync the second-brain Obsidian vault with its Slack canvas sources and ensure
any configured documentation-index summaries are complete. Reads every
source-tracked vault note, fetches the current canvas content, and updates
notes where the source has changed — without overwriting locally-added
sections.

## Step 0: Resolve the vault path

Resolution order (no hardcoded path, ever):

1. `SECOND_BRAIN_VAULT_PATH` env var.
2. `secondBrain.vaultPath` in `~/.claude/settings.json`.

If neither is set, stop and tell the user to set one. Do not guess a path.

## Step 1: Prerequisites check

A Slack MCP tool named `slack_read_canvas` must be available. Look for it by
name in the current session's tool list — the tool prefix changes across
sessions. If it is not available, stop and tell the user that Slack MCP
authentication is required.

## Step 2: Find all source-tracked notes

Use `mcp__obsidian__search_files` to search the vault for the string
`source: slack-canvas-`. This returns all notes that are sourced from Slack
canvases.

For each matching file, read it with `mcp__obsidian__read_file` and extract
from the frontmatter:
- `source` — the canvas ID in the form `slack-canvas-FXXXXXXX`; strip the
  `slack-canvas-` prefix to get the raw canvas ID
- `last_synced` — ISO date string (may be absent on first sync)
- the full file path

Build a list: `[{ canvas_id, vault_path, last_synced }]`

## Step 3: Fetch each canvas

For each entry, call `slack_read_canvas` with the canvas ID.

- On success: store the canvas content alongside the entry
- On `access_denied` or any error: log the canvas ID and error reason; mark
  the entry as `skipped`; continue to the next entry — never abort the whole
  run

## Step 4: Compare and update each note

For each entry where the canvas was successfully fetched:

**4a. Extract preserved sections**

Read the vault note and capture the verbatim content of any `## Local Notes`
and `## Links` sections. These are never overwritten.

**4b. Determine if the canvas content is meaningfully different**

Compare the canvas content to the current sourced sections of the vault note
(everything except `## Local Notes` and `## Links`). Meaningful change means
substantive differences in facts, structure, or wording — not cosmetic
whitespace.

**4c. If changed: rewrite the note**

Reconstruct the full note:

```
---
date: <original date>
tags: [<original tags>]
source: slack-canvas-<canvas_id>
last_synced: <today's date YYYY-MM-DD>
---

<synthesized content from canvas>

## Local Notes

<original ## Local Notes content, or empty if absent>

## Links

<original ## Links content, or empty if absent>
```

Write the reconstructed note using `mcp__obsidian__write_file`. Preserve the
original `date` and `tags` values from the frontmatter.

**4d. If unchanged: update only `last_synced`**

Use `mcp__obsidian__edit_file` to update the `last_synced:` line in the
frontmatter to today's date. If `last_synced` is absent, insert it after the
`source:` line.

## Step 5: Write sync report

Create a sync report at `00 Inbox/YYYY-MM-DD Sync Report.md` (using today's
date) with the following structure:

```markdown
---
date: YYYY-MM-DD
tags: [sync, report]
---

# Sync Report — YYYY-MM-DD

## Summary

- Canvases checked: N
- Notes updated: N
- Notes unchanged: N
- Canvases skipped (error): N

## Updated Notes

- [[Note Title]] — brief description of what changed

## Unchanged Notes

- [[Note Title]]

## Errors

- `canvas_id` — error reason
```

Use `mcp__obsidian__write_file` to write the report. If a report already
exists for today, append to it rather than overwriting.

## Step 6: Confirm

- **Manual run:** Print an inline summary (same counts as the report header)
  and mention the report path in `00 Inbox/`.
- **Scheduled run:** No inline output needed — the report in `00 Inbox/` is
  the record.
