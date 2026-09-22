# Steering mechanisms: which one to reach for

Claude Code has several ways to shape what an agent does. They differ in two things:
how much context they cost (always loaded, loaded on demand, or none) and how much
authority they have (advice the model can ignore, or a gate it can't). This page
records how this repo chooses between them, with a real example of each. It came out
of the audit in [#280](https://github.com/dfadler/agent-config/issues/280).

| Mechanism | Context cost | Authority | Use it here when | Example in this repo |
| --- | --- | --- | --- | --- |
| Convention file (`claude/conventions/*.md`, `@include`d into `~/.claude/CLAUDE.md`) | Every session, on every machine that includes it | Advisory | A short, always-true principle that applies across projects | [`secrets-handling.md`](../claude/conventions/secrets-handling.md) (default-enabled); [`shell-script-hygiene.md`](../claude/conventions/shell-script-hygiene.md) (opt-in) |
| Skill (`plugins/dfadler-agent-config/skills/*/SKILL.md`) | Description always; body only when invoked or relevant | Advisory | A multi-step procedure, or guidance long enough to crowd out everything else if always loaded | [`pr-babysit`](../plugins/dfadler-agent-config/skills/pr-babysit/SKILL.md), [`typescript-conventions`](../plugins/dfadler-agent-config/skills/typescript-conventions/SKILL.md) |
| Hook (`plugins/dfadler-agent-config/hooks/hooks.json`) | None unless it emits output | Enforced: runs every time, can block | A rule that must hold regardless of what the model decides, or a deterministic reminder at a fixed lifecycle point | `PreToolUse` worktree guard and `SessionStart` symlink check/prune, all from [`git-worktree-usage`](../plugins/dfadler-agent-config/skills/git-worktree-usage/SKILL.md); opt-in per project, see [`hook-composition.md`](./hook-composition.md) |
| Subagent (`plugins/dfadler-agent-config/agents/*.md`) | Its own context window, not the caller's | Advisory, but with its own tools and model | A focused job that should not see (or pollute) the main conversation, or that suits a cheaper or stronger model | `shell-script-reviewer` (haiku), `docs-staleness-checker` (sonnet), `adversarial-reviewer` (opus), per [`cheap-model-delegation.md`](../claude/conventions/cheap-model-delegation.md) |
| Path-scoped rule (`.claude/rules/*.md` with `paths:` frontmatter) | Only when Claude reads a matching file | Advisory | A constraint that only matters for certain files | None yet; see below |
| Output style / `--append-system-prompt` | Every request | Changes or extends the system prompt | Changing Claude's role or tone, or a one-off launch-time addition | Deliberately unused; see below |

The first two rows are the ones most often confused. The rule of thumb: if it reads
as "always do X", it's a convention; if it reads as "here's how to do X, step by
step", it's a skill. Anthropic's own guidance says the same thing about CLAUDE.md:
move multi-step procedures and part-of-the-codebase instructions into a skill or a
path-scoped rule
([memory docs](https://code.claude.com/docs/en/memory#when-to-add-to-claude-md)).

CLAUDE.md files, and anything `@include`d into them, are context, not enforcement.
If a rule has to hold even when the model decides otherwise, it needs a hook or a
`settings.json` permission rule
([memory docs](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory)).
[`contributing.md`](./contributing.md#why-skills-here-dont-declare-allowed-tools)
makes the same point about skill frontmatter.

## Path-scoped rules

A `.claude/rules/*.md` file with a `paths:` glob list in its frontmatter loads only
when Claude reads a matching file, not on every tool use. A rule without `paths:`
loads at launch like `.claude/CLAUDE.md`. User-level rules live in
`~/.claude/rules/` and apply to every project on the machine
([memory docs: path-specific rules](https://code.claude.com/docs/en/memory#path-specific-rules)).

This repo doesn't use them yet. Conventions are opted in wholesale per machine instead.
Candidates for scoping are tracked in #280 and #278.

## Stop vs. SessionEnd hooks

These two get mixed up when picking an end-of-turn or end-of-session reminder.

- `Stop` fires when Claude finishes responding. It can block, either by exit code 2
  or by `decision: "block"`, which keeps the conversation going. Its
  `hookSpecificOutput.additionalContext` reaches Claude
  ([hooks docs: Stop](https://code.claude.com/docs/en/hooks#stop)).
- `SessionEnd` fires when the session terminates. It has no decision control and
  can't block. Claude Code discards its JSON output, and it gets a 1.5-second
  default timeout. It's only good for cleanup or logging
  ([hooks docs: SessionEnd](https://code.claude.com/docs/en/hooks#sessionend)).

So anything that needs Claude to act, such as the wrap-up reminder that
[`memory-hygiene.md`](../claude/conventions/memory-hygiene.md#session-close-habit)
describes, has to be a `Stop` hook.

## Output styles and `--append-system-prompt`: deliberately unused

Output styles replace Claude Code's default instructions to change its role or tone.
`--append-system-prompt` adds a one-off per-launch addition
([output styles docs: comparisons](https://code.claude.com/docs/en/output-styles#comparisons-to-related-features)).
This repo does neither on purpose. It ships conventions that sit on top of the default
software-engineering role, not a different role. A per-launch flag also can't be
versioned or `@include`d the way a convention file can.
