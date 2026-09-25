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
  - `CLAUDE.md` — `~/.claude/CLAUDE.md` is a generated file whose managed section
    `@include`s this file, the user's own `CLAUDE.personal.md`, and the default
    convention files — not a symlink.
  - `conventions/` — one file per convention (worktree usage, secrets handling, etc.),
    each independently `@include`-able. `DEFAULT_ENABLED` controls which ones a fresh
    machine gets; everything else is opt-in via `~/.claude/CLAUDE.personal.md`.
  - `commands/` — slash commands, symlinked individually into `~/.claude/commands/`.
- `plugins/` — one directory per plugin. Each plugin's directory name matches its
  manifest `name`, which is what makes skills resolve as `<plugin-name>:<skill>`.
  - `dfadler-agent-config/` — the main plugin: cross-project agents and skills
    (PR shepherding, PR review rubric, adversarial code reviewer, worktree usage).
  - `accessibility-skills/` — WCAG 2.2 code review for web markup and CSS, graded
    with an evidence-basis/severity system.
  - `detached-terminal/` — run and drive an interactive terminal (TUI, REPL,
    alternate-screen app) on a headless PTY without stealing focus. Requires `pyte`.
  - `gh-attach-image/` — upload local images and videos to GitHub's
    user-attachments endpoint so they render inline in PR/issue bodies.
  - `gha-ci-audit/` — audit GitHub Actions usage for any repository: workflow
    volumes, critical-path analysis, cost/performance improvement opportunities.
  - `pr-visual-capture/` — produce screenshot (PNG) and walkthrough video (MP4)
    files for PR/issue visual verification using headless Chrome and CDP. Requires
    `gh-attach-image` to upload results.
  - `worktree-core/` — `git-worktree-usage` skill plus hooks that enforce worktree
    isolation and auto-prune merged worktrees.
- `docs/` — reference material for this repo's own tooling and CI.

See [`docs/plugin-loading.md`](docs/plugin-loading.md) for how a plugin directory
becomes `<plugin-name>:<skill>` in a live session.

## Setup on a new machine

```bash
git clone git@github.com:dfadler/agent-config.git ~/Development/agent-config
~/Development/agent-config/setup.sh
```

`setup.sh` generates `~/.claude/CLAUDE.md`'s managed section, symlinks
`claude/commands/` entry-by-entry, and links each plugin under `plugins/` into
`~/.claude/skills/` — all in one idempotent pass. Re-run it any time after pulling
to pick up new entries.

### Install a subset of features

See available feature names first (slash-command basenames and plugin directory names):

```bash
./setup.sh --list-features
```

Install everything **except** specific features (`--skip`):

```bash
./setup.sh --skip=accessibility-skills,gha-ci-audit
```

Install **only** specific features, leaving everything else out (`--include`):

```bash
./setup.sh --include=dfadler-agent-config,worktree-core
```

`--skip` and `--include` cannot be combined. Neither flag is remembered across runs —
re-running plain `./setup.sh` relinks anything a previous `--skip` or `--include` left
out. See [`docs/setup.md`](docs/setup.md) for the full details including subset
installs and the optional `pyte` dependency.

### Optional: install the `pyte` runtime dependency

The `detached-terminal` skill requires `pyte` to be importable by the ambient
`python3`. Pass `--install-deps` to let `setup.sh` install it:

```bash
./setup.sh --install-deps
```

Without the flag, a missing `pyte` is reported at the end of the run but doesn't
block setup. See [`docs/setup.md`](docs/setup.md) for caveats on
PEP 668 externally-managed interpreters.

## Teardown

```bash
~/Development/agent-config/teardown.sh
```

Removes every symlink this repo created in `~/.claude/` and restores
`~/.claude/CLAUDE.md` from `~/.claude/CLAUDE.personal.md`. Only symlinks that point
into this repo are touched; foreign symlinks (other skills-dir plugins, etc.) are left
alone. Safe to re-run. See [`docs/setup.md`](docs/setup.md#removing-from-a-machine).

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
  becomes `<plugin-name>:<skill>` in a live session.
- [`docs/companion-plugins.md`](docs/companion-plugins.md) — recommended standalone
  installs (mattpocock/skills, bulletproof-react-skills, vercel-labs/agent-skills,
  anthropics/skills, AWS Agent Toolkit, rtk, ponytail) and the Linux-administration
  vendor-vs-build-it-here decision.
- [`docs/contributing.md`](docs/contributing.md) — adding a skill/agent/command/hook,
  the `allowed-tools` decision, `make check`, and GitHub operations via `gh`.
- [`docs/scope.md`](docs/scope.md) — what belongs in this repo vs. a project's own
  `.claude/`.
- [`docs/steering-mechanisms.md`](docs/steering-mechanisms.md) — when to use a
  convention, skill, hook, subagent, or path-scoped rule here, and why output
  styles and `--append-system-prompt` aren't used.
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
- [`docs/memory-tooling-alternatives.md`](docs/memory-tooling-alternatives.md) —
  survey of memory tooling alternatives (mem0, Zep, Letta, Cognee, Supermemory, MCP
  reference server) evaluated against this repo's own auto-memory conventions.
