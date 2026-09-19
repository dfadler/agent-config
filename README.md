# agent-config

Version-controlled home for agent configuration that's generic enough to apply across
projects, not tied to any single repo. Each tool gets its own top-level directory
(Claude Code's is `claude/`) so this can hold config for other agent CLIs later without
the layouts colliding. The one exception is `plugins/`, which sits at the root because
Claude Code's plugin format expects it there. Content is symlinked into the tool's
own config dir — e.g. `~/.claude/` — so every project's session picks it up
automatically, with no per-project copy to keep in sync.

## Layout

- `claude/` — Claude Code config that isn't part of a plugin.
  - `CLAUDE.md` — a short intro plus a pointer at `conventions/`; `~/.claude/CLAUDE.md`
    is a generated file whose managed section `@include`s this file, the user's own
    `CLAUDE.personal.md`, and the default set of convention files (see below) — not a
    symlink.
  - `conventions/` — one file per convention (worktree usage, secrets handling, PR
    workflow, etc.), each independently `@include`-able. `DEFAULT_ENABLED` lists which
    ones a fresh machine gets automatically; everything else is opt-in — add an
    `@include` line to that machine's own `CLAUDE.personal.md` to enable it there.
  - `commands/` — slash commands, symlinked individually into `~/.claude/commands/`.
- `plugins/` — one directory per plugin, in the layout Claude Code's plugin format
  expects.
  - `dfadler-agent-config/` — the only plugin so far. Its directory name matches the
    `name` in its manifest, which is what makes its contents resolve as
    `dfadler-agent-config:<skill>`.
    - `.claude-plugin/plugin.json` — the plugin manifest (name, version, description).
    - `agents/` — subagent definitions.
    - `skills/` — skills, a directory each containing a `SKILL.md` plus any scripts.
    - `hooks/hooks.json` — hook events (e.g. `SessionStart`) the plugin wires up.
      Unlike a skill, a hook here is registered for every project the plugin is
      enabled in, but each hook is off by default and does nothing until that
      project's `.claude/settings.json` (or a session env var) explicitly opts
      it in — see `docs/hook-composition.md`. Scripts a hook invokes live
      wherever makes sense (a skill's own `scripts/`, if the hook is that
      skill's companion) and are addressed via `${CLAUDE_PLUGIN_ROOT}`, never a
      hardcoded path.
- `docs/` — reference material specific to this repo's own tooling and CI, not
  general enough for `claude/CLAUDE.md` (which is loaded globally, for every
  project). See [Further reading](#further-reading) below for the full list.

Agents and skills used to live under `claude/`; they moved into the plugin in commit
89a34ce. Nothing else moved — `CLAUDE.md` and `commands/` still sit under `claude/`.
See [`docs/plugin-loading.md`](docs/plugin-loading.md) for how the plugin directory
actually gets picked up by Claude Code and namespaced as `dfadler-agent-config:<name>`.

## Setup on a new machine

```bash
git clone git@github.com:dfadler/agent-config.git ~/Development/agent-config
~/Development/agent-config/setup.sh
```

`setup.sh` symlinks `claude/commands/`, generates `~/.claude/CLAUDE.md`'s managed
section, and links the `plugins/dfadler-agent-config/` directory into `~/.claude/` in
one idempotent pass. It supports installing only a subset of features
(`--skip`/`--include`), can install an optional runtime dependency (`pyte`) for the
`detached-terminal` skill, and can pre-approve one pinned installer command. Full
details: [`docs/setup.md`](docs/setup.md).

```bash
~/Development/agent-config/teardown.sh
```

`teardown.sh` is the inverse — removes every symlink this repo created and restores
your original `~/.claude/CLAUDE.md`. Safe to re-run. See
[`docs/setup.md`](docs/setup.md#removing-from-a-machine).

### Recommended companions

A handful of separately maintained plugins and tools (mattpocock/skills,
bulletproof-react-skills, vercel-labs/agent-skills, anthropics/skills'
`frontend-design`, AWS's Agent Toolkit, rtk, ponytail) pair well with this repo but
aren't vendored into it. See
[`docs/companion-plugins.md`](docs/companion-plugins.md) for what each one does and
how to install it.

## Adding something new

Skills, agents, and slash commands each have a specific place to go, a naming
convention (no `dfadler-agent-config-` prefix — the plugin namespace already prevents
collisions), and a `make check` pass before pushing. See
[`docs/contributing.md`](docs/contributing.md) for the full checklist, why skills
here don't declare `allowed-tools`, the `make check` target reference, and this
repo's `gh`-only convention for GitHub operations.

## What belongs here vs. in a project

If a rule/skill/agent only makes sense with a specific repo's paths, scripts, or stack
knowledge baked in, it stays in that project's own `.claude/`. This repo is for the
parts that would otherwise get copy-pasted into every new project's config, and it's a
**portable-subset collector**, not a single upstream source of truth — content flows in
both directions depending on where the work actually happens. See
[`docs/scope.md`](docs/scope.md) for the full reasoning, including when a project's own
copy of something is a deliberate fork rather than drift to reconcile.

## Further reading

- [`docs/setup.md`](docs/setup.md) — setup, subset installs, teardown, and the
  optional `pyte`/Aikido Safe Chain pieces.
- [`docs/plugin-loading.md`](docs/plugin-loading.md) — how the plugin directory
  becomes `dfadler-agent-config:<name>` in a live session.
- [`docs/companion-plugins.md`](docs/companion-plugins.md) — recommended standalone
  installs (mattpocock/skills, bulletproof-react-skills, vercel-labs/agent-skills,
  anthropics/skills, AWS Agent Toolkit, rtk, ponytail) and the Linux-administration
  vendor-vs-build-it-here decision.
- [`docs/contributing.md`](docs/contributing.md) — adding a skill/agent/command/hook,
  the `allowed-tools` decision, `make check`, and GitHub operations via `gh`.
- [`docs/scope.md`](docs/scope.md) — what belongs in this repo vs. a project's own
  `.claude/`.
- [`docs/hook-composition.md`](docs/hook-composition.md) — how this plugin's hooks
  compose with hooks from other plugins.
- [`docs/prompt-injection-defense.md`](docs/prompt-injection-defense.md) — the
  layered defense model for content Claude reads via web search, PRs, or issues.
- [`docs/settings-json-environment-audit.md`](docs/settings-json-environment-audit.md) —
  environment-layer companion to the prompt-injection doc.
- [`docs/github-actions.md`](docs/github-actions.md) — writing, hardening, and
  debugging this repo's own `.github/workflows/`.
- [`docs/usage-optimization.md`](docs/usage-optimization.md) — where Claude Code cost
  is spent in this repo.
