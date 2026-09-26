---
name: query
description: |
  Answer questions by searching and reading the second-brain Obsidian vault.
  Use when the user asks about something that might already be captured —
  recalling a decision, finding context about a system or person, reviewing
  meeting history, checking project status, or understanding a pattern. Also
  use proactively when vault context would make a response more accurate.
  Trigger on phrases like "what do I know about", "remind me", "find my notes
  on", "what did we decide about", "who is", "what's the history of", "look it
  up", or any question that past notes could answer.
metadata:
  version: "0.1.0"
---

# Query

Answer questions using the vault. Don't fall back to general knowledge and
present it as if it came from the vault — if the vault doesn't have the
answer, say so.

## Step 1: Resolve the vault path

Resolution order (no hardcoded path, ever):

1. `SECOND_BRAIN_VAULT_PATH` env var.
2. `secondBrain.vaultPath` in `~/.claude/settings.json`.

If neither is set, stop and tell the user to set one. Do not guess a path.

## Step 2: Search broadly

Use `mcp__obsidian__search_files` to find files relevant to the question.
Search for key terms, related people/projects/systems, and alternative
phrasings. Also check the directory tree for relevant folders using
`mcp__obsidian__directory_tree`.

## Step 3: Read the relevant notes

Use `mcp__obsidian__read_multiple_files` to read several notes at once.
Follow wikilinks (`[[Note Title]]`) to pull in connected notes — the vault's
value comes from connections, not individual files.

Prioritize:
- The most specific notes first (e.g. a note about that exact decision over a
  general area note)
- Recent notes over older ones when they conflict
- `30 Resources` for synthesized reference material
- `40 Meetings` for decision history
- `20 Areas` for ongoing context

## Step 4: Synthesize and answer

Answer the question directly using what you found. Be explicit about:
- Which notes the answer came from (path relative to vault root)
- How confident you are — flag if the vault has incomplete or conflicting
  information
- What's missing from the vault that would make this answer better

## Step 5: Offer to file the answer back

If the query produced a useful synthesis that isn't already captured —
especially one that took significant reasoning across multiple notes — offer
to save it back to the vault. This is how the vault grows smarter over time.

Example: "I synthesized this from three meeting notes. Want me to save this
summary to `30 Resources/`?"

Use the capture skill to do the filing if the user agrees.
