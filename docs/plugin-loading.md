# How the plugin gets loaded

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

See [`docs/setup.md`](./setup.md) for how `setup.sh` creates that symlink and
[`docs/contributing.md`](./contributing.md) for adding a new skill, agent, or
plugin to this layout.
