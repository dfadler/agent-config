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
  - `dfadler-agent-config/` — the only plugin so far. Its directory name matches the
    `name` in its manifest, which is what makes its contents resolve as
    `dfadler-agent-config:<skill>`.
    - `.claude-plugin/plugin.json` — the plugin manifest (name, version, description).
    - `agents/` — subagent definitions.
    - `skills/` — skills, a directory each containing a `SKILL.md` plus any scripts.

Agents and skills used to live under `claude/`; they moved into the plugin in commit
89a34ce. Nothing else moved — `CLAUDE.md` and `commands/` still sit under `claude/`.

### How the plugin gets loaded

Claude Code auto-loads any directory under `~/.claude/skills/` that carries a
`.claude-plugin/plugin.json`, as `<name>@skills-dir` — no marketplace and no install
step. It follows symlinks, so `setup.sh` links the whole
`plugins/dfadler-agent-config/` directory to `~/.claude/skills/dfadler-agent-config`,
and the plugin loads straight out of this working copy. Edits here are live in the next
session; there's nothing to commit, push, or update first.

Linking the plugin as a unit (rather than fanning its skills and agents out as
individual symlinks, which is what `setup.sh` used to do) is what buys the plugin an
identity — `claude plugin list` shows it with a version, `claude plugin disable` turns
it off, `claude plugin details dfadler-agent-config` prints its component inventory and
projected token cost, and `claude plugin validate plugins/dfadler-agent-config` checks
the manifest and every skill/agent it contains. The plugin's `agents/` are discovered from
inside it, so they don't get linked separately.

Loading it this way *does* namespace what it contains: the plugin's skills and agents
are exposed as `dfadler-agent-config:<name>`, not under bare names — in a live session
that's `dfadler-agent-config:pr-babysit`, and the agent as
`dfadler-agent-config:adversarial-reviewer`. What decides this is the `skills/`
subdirectory, not the manifest: a directory that keeps its `SKILL.md` at its own root
loads as a single skill under a bare name even when it does carry a
`.claude-plugin/plugin.json`. Only a `skills/` subdirectory produces the
`<plugin>:<skill>` form.

The namespace is the whole collision story, which is why skills and agents here are
named plainly — `pr-babysit`, not `dfadler-agent-config-pr-babysit`. They used to carry
that prefix, from back when they were linked in individually and shared a flat namespace
with every project's own skills; inside a namespaced plugin it only produced
`generic-tools:dfadler-agent-config-pr-babysit`, saying the same thing twice.

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
`plugins/dfadler-agent-config/` directory into `~/.claude/` in one pass. It's idempotent
— re-run it any time after pulling to pick up new entries. It only takes over a target
this repo already owns, or a symlink that's already broken; a real file, or a live
symlink pointing anywhere else, is reported and left alone. That matters most for
`~/.claude/skills/`, since that directory is shared with every other skills-dir plugin.

It also removes links this repo made that are no longer canonical: the per-entry skill
and agent symlinks older versions created (which would load the same skills twice
alongside the plugin), and the link under the plugin's old `generic-tools` name, which
the rename would otherwise leave dangling. Anything under `~/.claude/{skills,agents}`
pointing into this repo's `plugins/` that isn't the current plugin link is stale by
definition; links pointing anywhere else are left alone.

### Runtime dependency: `pyte`

The `detached-terminal` skill's `agent_term.py` is `#!/usr/bin/env python3`, so it runs
under whatever `python3` is first on `PATH` when an agent invokes it. Nothing activates
this repo's `.venv` (the one `make venv` builds for CI) on the skill's behalf, so a green
`make check` says nothing about whether the skill can start — [`pyte`](https://github.com/selectel/pyte)
has to be importable by that *ambient* interpreter.

`setup.sh` checks it at the end of a run. If it's missing, the run still succeeds (the
symlinks are correct either way) but it names the interpreter and prints the command:

```bash
python3 -m pip install --user pyte
```

Or let `setup.sh` do it:

```bash
./setup.sh --install-deps
```

That's opt-in because installing into an interpreter this repo doesn't own is a bigger
claim than symlinking config. On a PEP 668 externally-managed interpreter — a Homebrew or
distro `python3` — `pip install --user` is refused; `setup.sh` detects that up front and
prints the real options (the OS package, `--break-system-packages`, or putting an
interpreter you own first on `PATH`) rather than letting pip fail confusingly. The skill
still carries its own "pyte is not installed" error as the last line of defence for anyone
who skips setup.

## Adding something new

1. Put it in the right place:
   - A **skill** → a new directory under `plugins/dfadler-agent-config/skills/`,
     containing a `SKILL.md`.
   - An **agent** → a new `.md` file under `plugins/dfadler-agent-config/agents/`.
   - A **slash command** → a new `.md` file under `claude/commands/`.
   - A whole new **plugin** (a set of skills/agents that belong together) → a new
     directory under `plugins/`, with its own `.claude-plugin/plugin.json`, `agents/`,
     and `skills/`. Give it a `PLUGIN_SRC`/`PLUGIN_LINK` pair and a `link` line in
     `setup.sh`, which only knows about `dfadler-agent-config`. Keep the directory name
     and the manifest `name` identical.
2. Name skills and agents plainly — `pr-babysit`, not `dfadler-agent-config-pr-babysit`
   — in both the directory/filename and the frontmatter `name:`. The plugin namespace
   already prevents collisions with a project's own skills, so a prefix here would just
   repeat it. Commands stay unprefixed for a different reason: `claude/commands/` is
   linked entry-by-entry into `~/.claude/commands/`, outside any plugin, so those names
   really are flat.
3. Run `claude plugin validate plugins/dfadler-agent-config` — it checks the manifest
   and parses the frontmatter of every skill and agent inside.
4. Run `make check` (see below) before pushing.
5. Commit and push. A new skill or agent inside an already-linked plugin needs no
   `setup.sh` re-run; anything under `claude/`, or a whole new plugin, does.

## Checks

`make check` runs everything CI runs, and CI calls these same targets — so a green
run locally means the same thing a green PR does.

```bash
make check          # lint + structure + typecheck + test + actionlint + coverage
```

| Target | What it does |
| --- | --- |
| `make lint-sh` | `shellcheck`, `shfmt -i 2 -ci -d`, and the `set -uo pipefail` convention |
| `make lint-py` | `ruff check` and `ruff format --check` |
| `make typecheck` | `mypy --strict` over the Python sources |
| `make structure` | Plugin manifests and skill/agent frontmatter agree with their directories |
| `make test-sh` | `bats` suites under `scripts/tests/` |
| `make test-py` | `pytest` suite under `scripts/tests/` |
| `make coverage` | Re-runs the `bats` suites under `kcov` and enforces the coverage floor (Linux only) |
| `make fmt` | Rewrites sources to the repo's `shfmt` / `ruff` style |
| `make lint-actions` | `actionlint` over `.github/workflows/` |

```bash
brew install shellcheck shfmt bats-core actionlint
make venv          # Python side: .venv from requirements-dev.txt
```

`make check` uses `.venv` when it exists and otherwise falls back to whatever
`python3` is on `PATH`, so a shell-only change doesn't require building one.

`make coverage` needs `kcov` and `jq` on top of the tools above. It only measures
anything on Linux: kcov instruments bash by injecting a library into the traced
shell, and macOS SIP strips that from `/bin/bash`, so on a Mac the target says so
and skips rather than reporting a meaningless 0%. The floor it enforces is a
measured baseline (see the `coverage` target in the `Makefile` for the number, how
it was taken, and what is and isn't in the denominator) — a regression gate, not a
target to design tests around.

Two checks exist because a linter can't express them. `check-shell-set-flags.sh`
enforces the `set -uo pipefail` opener from the global `CLAUDE.md`, which shellcheck
has no rule for. `check-plugin-structure.sh` is the closest thing to a typechecker a
shell-and-Markdown repo can have: this repo's *product* is declarative metadata, and a
skill whose `name:` drifts from its directory fails silently at load time rather than
loudly in review — which is exactly what the plugin rename could have caused.

The `bats` suites are hermetic: `HOME` is redirected into a sandbox and the network
binaries are shimmed to fail loudly, so a test can never touch your real `~/.claude`
even though `setup.sh`'s whole job is writing symlinks into it. The `pytest` suite
forks real PTYs, with `AGENT_TERM_STATE` redirected per test and every session torn
down in a fixture, so it can't collide with a live session either.

## What belongs here vs. in a project

If a rule/skill/agent only makes sense with a specific repo's paths, scripts, or stack
knowledge baked in, it stays in that project's own `.claude/`. This repo is for the
parts that would otherwise get copy-pasted into every new project's config.

One exception: a project may keep its own **vendored copy** of something that also
lives here, if that project's CI needs it — GitHub Actions runners check out only the
repo, not this machine's `~/.claude`, so anything a CI job invokes (a skill it `cat`s
into a prompt, a rubric it loads) has to physically exist in that repo. Vendored copies
should stay in sync with the canonical version here, but won't update automatically.
