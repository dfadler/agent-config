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
| Hook (`plugins/worktree-core/hooks/hooks.json`) | None unless it emits output | Enforced: runs every time, can block | A rule that must hold regardless of what the model decides, or a deterministic reminder at a fixed lifecycle point | `PreToolUse` worktree guard and `SessionStart` symlink check/prune, all from [`git-worktree-usage`](../plugins/worktree-core/skills/git-worktree-usage/SKILL.md); opt-in per project, see [`hook-composition.md`](./hook-composition.md) |
| Subagent (`plugins/dfadler-agent-config/agents/*.md`) | Its own context window, not the caller's | Advisory, but with its own tools and model | A focused job that should not see (or pollute) the main conversation, or that suits a cheaper or stronger model | `shell-script-reviewer` (haiku), `docs-staleness-checker` (sonnet), `adversarial-reviewer` (opus), per [`cheap-model-delegation.md`](../claude/conventions/cheap-model-delegation.md) |
| Path-scoped rule (`.claude/rules/*.md` with `paths:` frontmatter) | Only when Claude reads a matching file | Advisory | A constraint that only matters for certain files | None yet; see below |
| Output style / `--append-system-prompt` | Every request | Changes or extends the system prompt | Changing Claude's role or tone, or a one-off launch-time addition | Deliberately unused; see below |

The first two rows are the ones most often confused. The rule of thumb: if it reads
as "always do X", it's a convention; if it reads as "here's how to do X, step by
step", it's a skill. Anthropic's own guidance says the same thing about CLAUDE.md:
move multi-step procedures and part-of-the-codebase instructions into a skill or a
path-scoped rule
([memory docs](https://code.claude.com/docs/en/memory#when-to-add-to-claude-md)).

CLAUDE.md files are context, not enforcement — a rule that must hold needs a hook
or `settings.json` permission rule instead
([memory docs](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory)).
Full rationale, plus the same point about skill frontmatter:
[research notes](https://github.com/dfadler/agent-config/issues/280#issuecomment-5783291566).

## Path-scoped rules

Not used yet — conventions are opted in wholesale per machine instead of scoped by
file path. Candidates are tracked in #280 and #278. Details, sourcing:
[research notes](https://github.com/dfadler/agent-config/issues/280#issuecomment-5783291566).

## Stop vs. SessionEnd hooks

`Stop` can block and reach Claude; `SessionEnd` can't and its output is discarded —
so a wrap-up reminder like [`memory-hygiene.md`](../claude/conventions/memory-hygiene.md#session-close-habit)
needs `Stop`, not `SessionEnd`. Details, sourcing:
[research notes](https://github.com/dfadler/agent-config/issues/280#issuecomment-5783291566).

## Output styles and `--append-system-prompt`: deliberately unused

This repo ships conventions on top of Claude Code's default role, not a different
one, and a per-launch flag can't be versioned or `@include`d. Details, sourcing:
[research notes](https://github.com/dfadler/agent-config/issues/280#issuecomment-5783291566).
