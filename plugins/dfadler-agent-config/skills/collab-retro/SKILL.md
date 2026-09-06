---
name: collab-retro
description: |
  Retrospective over how Claude and the user have been working together across
  sessions: scans this machine's `feedback`-type auto-memory entries (corrections
  and confirmed approaches, not just this conversation), filters for ones that are
  recurring and fixable via this repo's own config/skills/docs rather than a one-off
  preference already handled by memory, redacts anything project-specific or
  sensitive, and drafts a public GitHub issue on dfadler/agent-config proposing the
  improvement. Use when the user asks for a "retro", "self-improvement check",
  "what should we improve about how we work together", or explicitly invokes this
  skill by name — also usable under /loop for a recurring cadence. Never runs
  `gh issue create` without going through `gh-publish-permission` first: it drafts
  and shows the issue body, then asks.
metadata:
  version: "1.0.0"
---

# Collaboration retrospective

This skill turns recurring friction (or recurring validated judgment calls)
between Claude and the user into a concrete, actionable GitHub issue on
`dfadler/agent-config` — the same repo that already holds the global
`CLAUDE.md`, skills, and settings this feedback would actually change.

It deliberately does **not** try to detect and act on every miscommunication
live, mid-conversation. That's what the `feedback`-type auto-memory system
already does (see `claude/CLAUDE.md`'s "auto memory" section) — this skill's
job is a periodic step *on top of* that: look across what memory has already
collected, notice what's recurring or structural, and propose turning it into
a change to this repo rather than something that just sits in memory forever.

## Step 1 — gather candidates

Run the scanner:

```bash
plugins/dfadler-agent-config/skills/collab-retro/scripts/scan-feedback-memories.sh
```

This lists every `feedback`-type memory file across all projects on this
machine (tab-separated: mtime, project slug, memory name, path), newest
first, skipping any file already marked as surfaced by a prior collab-retro
issue (see Step 5). Read each candidate file directly — the script only
locates them; it doesn't parse or judge their content.

If invoked mid-session rather than as a standalone retro, also consider the
current conversation for a fresh correction or confirmation that hasn't been
saved to memory yet (per the auto-memory rules) — but still run the scanner,
since the point of this skill is cross-session pattern-spotting, not
re-litigating just the current conversation.

## Step 2 — filter for issue-worthy patterns

Most `feedback` memories are legitimately fine staying as memory — they're
personal preference, already correctly applied, and don't need a public
issue. Only draft an issue when a candidate (or a cluster of related
candidates) clears **all** of these:

- **Recurring or structural** — the same friction shows up across more than
  one project/session, or it points at a gap in shared tooling (a missing
  `CLAUDE.md` rule, a skill that should exist, a `settings.json` permission
  rule) rather than a one-off preference for a single task.
- **Fixable from this repo** — the proposed change is something that could
  plausibly land as an edit to `claude/CLAUDE.md`, a plugin skill, an agent
  definition, or repo tooling. If the fix is "just remember this," memory
  already has it covered and no issue is needed.
- **Not already tracked** — check open issues first:
  ```bash
  gh issue list --repo dfadler/agent-config --label agent-improvement --state open
  ```
  If an existing issue already covers the same pattern, don't open a
  duplicate — note the match in your report to the user instead (commenting
  on the existing issue is its own publish action and needs its own
  permission, per `gh-publish-permission`).

If nothing clears this bar, say so and stop — a retro with no findings is a
valid, useful outcome, not a failure to force a result from.

## Step 3 — redact before drafting

`dfadler/agent-config` is a **public** repo (see the `project_public_repo`
memory). Before drafting anything, generalize away:

- Any other project's name, employer, client, or business context.
- File paths, code, or identifiers outside this repo.
- Anything that would only make sense with private context the reader can't
  have — describe the *pattern* of the miscommunication or the gap, not the
  specific task or repo it happened on.

A useful test: could this issue body be understood, and would it read as
reasonable, to someone with zero visibility into the user's other work? If
not, generalize further or drop the candidate.

## Step 4 — draft the issue

```markdown
🤖 **Claude:** Drafted by the `collab-retro` skill — a retrospective over
recurring friction/confirmed patterns, not a specific session's transcript.

## Pattern observed

<the generalized, redacted description of what kept happening>

## Why it's worth fixing here

<recurrence across N sessions/projects, or the structural gap it points at —
no need to name the other projects, just that it recurred>

## Suggested change

<a concrete, scoped suggestion: a CLAUDE.md line, a new/updated skill, a
settings.json rule — not "think about this more">
```

Title: short and specific to the gap, not to any one incident (e.g. "Add a
CLAUDE.md rule for X" rather than "Claude did X wrong on <date>").

Label: `agent-improvement`. Create it first if it doesn't exist yet:

```bash
gh label list --repo dfadler/agent-config | grep -q agent-improvement || \
  gh label create agent-improvement \
    --repo dfadler/agent-config \
    --description "Suggested from a collab-retro pass" \
    --color BFD4F2
```

## Step 5 — permission, then post

Creating an issue is a publish action — follow
`dfadler-agent-config:gh-publish-permission` before running `gh issue
create`. In practice that means: show the drafted title, body, and label to
the user in chat and get an explicit go-ahead for *this* issue, even when the
retro itself was explicitly requested — a standalone invocation authorizes
running the retro, not blindly posting whatever it finds.
`.claude/settings.json`'s `ask` rule on `gh issue create` still surfaces its
own confirmation regardless.

After a successful `gh issue create`, mark every memory file that
contributed to it as surfaced, so a later retro doesn't redraft the same
issue: append a line to each file (after its content, not inside the
frontmatter) —

```
Surfaced as dfadler/agent-config#<number> on <YYYY-MM-DD>.
```

## Step 6 — report

Tell the user what was found either way: the issue opened (with its URL), a
duplicate matched and skipped (with the existing issue's URL), or that
nothing cleared the bar this pass. Don't editorialize beyond that — the
issue body itself should stand on its own.
