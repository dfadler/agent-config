# Global instructions

Conventions and habits that apply across projects, not just one repo. Project-level
`CLAUDE.md` files hold repo-specific mechanics (exact scripts, doc paths, lint-rule
names, label taxonomies); this file holds the general principle behind them so it
doesn't need to be re-written per project.

Each convention lives in its own file under `claude/conventions/`, included
individually rather than as one monolithic block. A fresh machine gets only the
files listed in `claude/conventions/DEFAULT_ENABLED` — a short, low-controversy
default set — via the `@include` lines `setup.sh` generates. To enable more on a
given machine, run `./setup.sh --include=git-worktree-usage` (name without `.md`;
`./setup.sh --list-features` lists them). Setup remembers the choice in
`~/.claude/agent-config.conventions` and reapplies it on every later run and on
`./upgrade.sh`; `./setup.sh --skip=<name>` removes one. Do not hand-edit
`CLAUDE.personal.md` for this. See `claude/conventions/DEFAULT_ENABLED` for what
ships by default.

Before adding a new convention file, check `claude/conventions/README.md` to see
whether it belongs as an include at all. Anything with a recognizable task trigger
should be a skill instead.
