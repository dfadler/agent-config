# agent-config

Version-controlled home for Claude Code configuration that's generic enough to apply
across projects, not tied to any single repo. Symlinked into `~/.claude/` so every
project's session picks it up automatically, with no per-project copy to keep in sync.

## Layout

- `CLAUDE.md` — global instructions (`~/.claude/CLAUDE.md` is a symlink to this file).
- `agents/` — subagent definitions, symlinked individually into `~/.claude/agents/`.
- `commands/` — slash commands, symlinked individually into `~/.claude/commands/`.
- `skills/` — skills, symlinked individually into `~/.claude/skills/`.

## Adding something new

1. Add the file under the right directory here, commit and push.
2. Symlink it into `~/.claude/` (matching the existing entries):
   ```bash
   ln -s ~/Development/agent-config/agents/<name>.md ~/.claude/agents/<name>.md
   ```

## What belongs here vs. in a project

If a rule/skill/agent only makes sense with a specific repo's paths, scripts, or stack
knowledge baked in, it stays in that project's own `.claude/`. This repo is for the
parts that would otherwise get copy-pasted into every new project's config.

One exception: a project may keep its own **vendored copy** of something that also
lives here, if that project's CI needs it — GitHub Actions runners check out only the
repo, not this machine's `~/.claude`, so anything a CI job invokes (a skill it `cat`s
into a prompt, a rubric it loads) has to physically exist in that repo. Vendored copies
should stay in sync with the canonical version here, but won't update automatically.
