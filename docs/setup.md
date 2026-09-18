# Setup, subset installs, and removal

How `setup.sh`/`teardown.sh` link this repo into `~/.claude`, how to install
only part of it, and the two optional runtime pieces (`pyte`, the Aikido Safe
Chain permission rule) setup can wire up for you.

## Setup on a new machine

```bash
git clone git@github.com:dfadler/agent-config.git ~/Development/agent-config
~/Development/agent-config/setup.sh
```

`setup.sh` generates `~/.claude/CLAUDE.md`'s managed section (`@include`-ing
`claude/CLAUDE.md` plus the default set from `claude/conventions/DEFAULT_ENABLED`),
symlinks the contents of `claude/commands/`, and symlinks the
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

See [`docs/plugin-loading.md`](./plugin-loading.md) for how the linked plugin
directory actually gets picked up by Claude Code and why its contents load
under the `dfadler-agent-config:<name>` namespace.

### Installing a subset of features

By default `setup.sh` installs everything — every slash command under `claude/commands/`
and every plugin under `plugins/` — the same all-or-nothing behavior it has always had.
Two flags narrow that, over the same flat namespace of feature names: a slash command's
basename (`adversarial-review`, from `claude/commands/adversarial-review.md`) or a
plugin's directory name (`dfadler-agent-config`, `accessibility-skills`, from
`plugins/`). `./setup.sh --list-features` prints the exact names available on this
checkout without linking anything.

To leave specific features out and keep everything else, pass `--skip` with a
comma-separated list:

```bash
./setup.sh --skip=adversarial-review,accessibility-skills
```

To install *only* specific features and leave everything else out, pass `--include`
instead:

```bash
./setup.sh --include=adversarial-review,dfadler-agent-config
```

The two are opposite selections over the same names, so passing both in one run is
rejected with an error rather than guessing which one wins. Naming a plugin opts out (or
in) its skills, agents, and hooks together — a plugin is linked into `~/.claude/skills/`
as a single unit (see [`docs/plugin-loading.md`](./plugin-loading.md)), so there's no
finer-grained way to symlink only part of one.

Neither flag is remembered across runs — it only applies to the run it's passed on.
Re-running plain `./setup.sh` relinks anything a previous `--skip` or `--include` left
out, and re-running with a *different* `--skip`/`--include` list links or unlinks
whatever the change affects. All directions are idempotent: a repeated run with the same
flags changes nothing.

This is a separate mechanism from the per-project hook toggles described in
`docs/hook-composition.md` — every hook in `dfadler-agent-config` already ships off by
default and stays off until a project's own `.claude/settings.json` (or a session env
var) opts it in, regardless of `--skip`/`--include`. Those flags control whether this
machine gets the plugin (and therefore its hooks' *code*) at all; the per-project
settings control whether an installed hook actually *does* anything in a given repo.

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

### Optional: pre-approving the Aikido Safe Chain installer

Some repos' `CONTRIBUTING.md` ask contributors to install
[Aikido Safe Chain](https://github.com/AikidoSec/safe-chain) — a free, tokenless CLI that
wraps `npm`/`pnpm`/`npx`/`yarn` and blocks installs of packages flagged as malware or
published in the last 48 hours. Its documented installer is a `curl | sh` pipeline pinned
to an exact version and verified against a published sha256 before it runs — but Claude
Code's auto-mode classifier blocks any pipe-to-shell installer by default, checksum or not.

At the end of a run, `setup.sh` asks (interactively, y/n) whether to add a Bash permission
rule to `~/.claude/settings.json` that pre-approves exactly that pinned command, so a future
agent session doesn't have to stop and ask. It's an exact-string match tied to one specific
version and checksum — not a blanket `curl *` allow — and it only *allowlists* the command;
it doesn't run the installer itself. This is the reference example the
`dfadler-agent-config:fetch-execute-guide` skill points to for when a standing,
already-approved rule like this one is allowed to skip the ask-every-time default: the user
approved this exact pinned command once, visibly, through this y/n prompt — a broad or
wildcard rule never gets the same treatment. The prompt is skipped cleanly (no hang) when there's no
interactive terminal, e.g. in CI or a piped run.

Answer no, or run non-interactively, and nothing is written. Add the rule later with:

```bash
./scripts/offer-safe-chain-permission.sh --yes
```

or remove it any time from `~/.claude/settings.json`'s `permissions.allow` array.

## Removing from a machine

```bash
~/Development/agent-config/teardown.sh
```

`teardown.sh` is the inverse of `setup.sh`: it removes every symlink this repo
created in `~/.claude` and restores `~/.claude/CLAUDE.md` from
`~/.claude/CLAUDE.personal.md`. If `CLAUDE.personal.md` is non-empty (your original
`CLAUDE.md` before setup.sh migrated it), it is moved back to `CLAUDE.md`. If it's
empty (the placeholder setup.sh created when there was nothing to migrate), it is
removed and `CLAUDE.md` is left absent.

Only symlinks that point into this repo are removed. Foreign symlinks — including any
other skills-dir plugins under `~/.claude/skills/` — are left untouched.

It's safe to re-run: a second pass is silent.

See also: [companion plugins](./companion-plugins.md) for optional installs
`setup.sh` doesn't manage, and [contributing](./contributing.md) for adding
new content that `setup.sh` then picks up.
