---
name: capture
description: |
  Save information to the second-brain Obsidian vault. Use when the user wants
  to capture, save, log, add, or record something — a meeting note, a decision,
  a person's details, a useful link, a project update, something from Slack, or
  any other information worth preserving. Also use proactively when notable
  information comes up in a session that should be findable later. Trigger on
  phrases like "save this", "capture this", "add a note", "log this", "remember
  this", "put this in my second brain", or when any notable information is shared
  that should be findable later.
metadata:
  version: "0.1.0"
---

# Capture

Save raw material to the vault. Capture everything worth keeping — it's better
to capture imperfectly than not capture at all.

## Step 1: Resolve the vault path

Resolution order (no hardcoded path, ever):

1. `SECOND_BRAIN_VAULT_PATH` env var.
2. `secondBrain.vaultPath` in `~/.claude/settings.json`.

If neither is set, stop and tell the user to set one. Do not guess a path.

## Step 2: Classify the content

Determine where the note belongs based on what it is:

| Content type | Destination |
|---|---|
| Meeting notes | `40 Meetings/YYYY-MM-DD Title.md` |
| Notes about a person | `50 People/Full Name.md` |
| Active project update or context | `10 Projects/Project Name/` |
| Reference material (architecture, patterns, runbooks) | `30 Resources/` appropriate subfolder |
| Anything unclear or that needs processing | `00 Inbox/YYYY-MM-DD Title.md` |

When in doubt, use `00 Inbox`.

## Step 3: Check for an existing note

Before creating a new file, use `mcp__obsidian__search_files` to check if a
note already exists for this person, project, or topic. If it does, use
`mcp__obsidian__edit_file` to append to it rather than creating a duplicate.

## Step 4: Write the note

Use `mcp__obsidian__write_file` (new note) or `mcp__obsidian__edit_file`
(append to existing).

### Frontmatter

Every note starts with:

```yaml
---
date: YYYY-MM-DD
tags: [relevant, tags]
---
```

Meeting notes also include:
```yaml
attendees: [Name1, Name2]
```

### File naming

- Dated content: `YYYY-MM-DD Title.md`
- Evergreen content (people, concepts, runbooks): `Title.md`
- Title case, no special characters except hyphens and spaces

### Content

- Lead with the most important information
- Use headings to make the note scannable
- For meeting notes: make decisions and action items prominent under
  `## Decisions` and `## Action Items`
- Write for a future reader who has forgotten the context

## Step 5: Cross-link

After writing the note, add Obsidian wikilinks (`[[Note Title]]`) to connect
it to related existing notes — people involved, the project it relates to, any
systems or concepts mentioned.

## Step 6: Confirm

Tell the user where the note was saved and what it's linked to.
