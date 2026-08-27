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
  - `CLAUDE.md` — global instructions (`~/.claude/CLAUDE.md` is a symlink to this file).
  - `commands/` — slash commands, symlinked individually into `~/.claude/commands/`.
- `plugins/` — one directory per plugin, in the layout Claude Code's plugin format
  expects.
  - `generic-tools/` — the only plugin so far.
    - `.claude-plugin/plugin.json` — the plugin manifest (name, version, description).
    - `agents/` — subagent definitions.
    - `skills/` — skills, a directory each containing a `SKILL.md` plus any scripts.

Agents and skills used to live under `claude/`; they moved to `plugins/generic-tools/`
in commit 89a34ce. Nothing else moved — `CLAUDE.md` and `commands/` still sit under
`claude/`.

### How the plugin gets loaded

Claude Code auto-loads any directory under `~/.claude/skills/` that carries a
`.claude-plugin/plugin.json`, as `<name>@skills-dir` — no marketplace and no install
step. It follows symlinks, so `setup.sh` links the whole `plugins/generic-tools/`
directory to `~/.claude/skills/generic-tools` and the plugin loads straight out of this
working copy. Edits here are live in the next session; there's nothing to commit, push,
or update first.

Linking the plugin as a unit (rather than fanning its skills and agents out as
individual symlinks, which is what `setup.sh` used to do) is what buys the plugin an
identity — `claude plugin list` shows it with a version, `claude plugin disable` turns
it off, `claude plugin details generic-tools` prints its component inventory and
projected token cost, and `claude plugin validate plugins/generic-tools` checks the
manifest and every skill/agent it contains. The plugin's `agents/` are discovered from
inside it, so they don't get linked separately.

Loading it this way *does* namespace what it contains: the plugin's skills and agents
are exposed as `generic-tools:<name>`, not under bare names — in a live session that's
`generic-tools:dfadler-agent-config-pr-babysit`, and the agent as
`generic-tools:dfadler-agent-config-adversarial-reviewer`. What *isn't* namespaced is a
directory under `~/.claude/skills/` holding a `SKILL.md` at its own root instead of a
`skills/` subdirectory — that's a single flat skill, not a plugin. So the
`dfadler-agent-config-` prefix on skill and agent names is no longer what prevents
collisions; it's kept as-is because renaming would churn every directory, every
frontmatter `name:`, and any vendored copies in other repos.

Sharing the plugin with another machine or person would need a
`.claude-plugin/marketplace.json` at the repo root; that isn't here yet, and adding it
later wouldn't change how this machine loads the plugin.

A future tool gets its own sibling directory (e.g. `codex/`) with whatever layout that
tool expects, symlinked into its own config location the same way.

## Setup on a new machine

```bash
git clone git@github.com:dfadler/agent-config.git ~/Development/agent-config
~/Development/agent-config/setup.sh
```

`setup.sh` symlinks `claude/CLAUDE.md`, the contents of `claude/commands/`, and the
`plugins/generic-tools/` directory into `~/.claude/` in one pass. It's idempotent —
re-run it any time after pulling to pick up new entries. It only takes over a target
this repo already owns, or a symlink that's already broken; a real file, or a live
symlink pointing anywhere else, is reported and left alone. That matters most for
`~/.claude/skills/generic-tools`, since that directory is shared with every other
skills-dir plugin. It also clears out the per-entry skill and agent symlinks that older
versions of the script created, which would otherwise load the same skills a second time
alongside the plugin.

## Adding something new

1. Put it in the right place:
   - A **skill** → a new directory under `plugins/generic-tools/skills/`, containing a
     `SKILL.md`.
   - An **agent** → a new `.md` file under `plugins/generic-tools/agents/`.
   - A **slash command** → a new `.md` file under `claude/commands/`.
   - A whole new **plugin** (a set of skills/agents that belong together) → a new
     directory under `plugins/`, with its own `.claude-plugin/plugin.json`, `agents/`,
     and `skills/`. Add a `link` line for it in `setup.sh`, which only knows about
     `generic-tools`.
2. Name skills and agents `dfadler-agent-config-<name>` — both the directory/filename
   and the frontmatter `name:` — to match everything already here. The plugin namespaces
   its contents as `generic-tools:<name>`, so the prefix isn't load-bearing for
   collision avoidance; it's just the standing convention. Commands stay unprefixed, and
   they really are flat: `claude/commands/` is linked entry-by-entry into
   `~/.claude/commands/`, outside any plugin.
3. Run `claude plugin validate plugins/generic-tools` — it checks the manifest and
   parses the frontmatter of every skill and agent inside.
4. Commit and push. A new skill or agent inside an already-linked plugin needs no
   `setup.sh` re-run; anything under `claude/`, or a whole new plugin, does.

## What belongs here vs. in a project

If a rule/skill/agent only makes sense with a specific repo's paths, scripts, or stack
knowledge baked in, it stays in that project's own `.claude/`. This repo is for the
parts that would otherwise get copy-pasted into every new project's config.

One exception: a project may keep its own **vendored copy** of something that also
lives here, if that project's CI needs it — GitHub Actions runners check out only the
repo, not this machine's `~/.claude`, so anything a CI job invokes (a skill it `cat`s
into a prompt, a rubric it loads) has to physically exist in that repo. Vendored copies
should stay in sync with the canonical version here, but won't update automatically.
