# How plugins get loaded

Claude Code auto-loads any directory under `~/.claude/skills/` that carries a
`.claude-plugin/plugin.json`, as `<name>@skills-dir` — no marketplace and no install
step. It follows symlinks, so `setup.sh` links each directory under `plugins/` that
contains a `plugin.json` file into `~/.claude/skills/<name>`, and the plugin loads
straight out of this working copy. Edits here are live in the next session; there's
nothing to commit, push, or update first.

This repo currently ships ten plugins under `plugins/`:
`accessibility-skills`, `detached-terminal`, `dfadler-agent-config`, `fetch-execute-guide`, `gh-attach-image`,
`gha-ci-audit`, `pr-visual-capture`, `typescript-gotchas`, `vite`, and `worktree-core`.
Each gets its own `~/.claude/skills/<name>` link and loads under its own namespace.
The sections below use `dfadler-agent-config` as the concrete example; the mechanics
apply identically to every plugin in the list.

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

## Single-skill plugins: bare skill vs. plugin

A plugin isn't required for one skill. Claude Code loads a skill straight from
`~/.claude/skills/<name>/SKILL.md` (personal), `.claude/skills/<name>/SKILL.md`
(project, committed), or `--add-dir`'s `.claude/skills/`, symlinks included, with no
manifest ([Skills: choose where skills load](https://code.claude.com/docs/en/skills);
[Plugins: do you need one](https://code.claude.com/docs/en/plugins#decide-whether-you-need-a-plugin)).
Pick by what the skill needs:

| Need | Bare skill | Plugin |
|---|---|---|
| Name | `/name`, no prefix; collides with same-named personal/project skills (enterprise > personal > project) | `/plugin:skill`; doesn't collide with bare skill names (two enabled plugins with the same manifest name still resolve by source precedence) |
| Extras (agents, hooks, MCP) | No | Yes |
| Install / update / disable / version | Copy or symlink by hand | `claude plugin list/disable`, marketplace updates |
| `claude plugin validate` | Not applicable | Yes |
| Share with others | Commit to `.claude/skills/` (repo-scoped only) | Marketplace; project scope via `.claude/settings.json` (each collaborator still installs it) |

Recommended pattern here: a single-skill plugin that only lives on this machine can
stay a plugin (it gets `claude plugin details`/`validate`), but put `SKILL.md` at the
plugin root instead of under `skills/` so it loads as `name`, not `name:name` (see
above). Use a plain bare skill for a throwaway or project-only skill. Agents and
hooks can sit alongside a root `SKILL.md`; use the `skills/` layout and its namespace
only for additional skills.

Platform gap: none found. A bare skill just has no namespace, validate, or
marketplace path; that is the intended trade, not a missing feature. The
root-`SKILL.md` plugin behavior above is observed here, not something the docs state
outright, so recheck it after Claude Code upgrades. Detail in
[#389](https://github.com/dfadler/agent-config/issues/389).

Sharing the plugin with another machine or person would need a
`.claude-plugin/marketplace.json` at the repo root; that isn't here yet, and adding it
later wouldn't change how this machine loads the plugin.

See [`docs/setup.md`](./setup.md) for how `setup.sh` creates these symlinks and
[`docs/contributing.md`](./contributing.md) for adding a new skill, agent, or
plugin to this layout.
