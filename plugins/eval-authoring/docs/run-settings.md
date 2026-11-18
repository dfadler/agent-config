# Run settings and pre-approval

How `run-evals` sets the ceiling, run count and jobs of a paid run, and how a user
pre-approves paid runs. Tracking: [#1116](https://github.com/dfadler/agent-config/issues/1116).

## Settings

Precedence, highest first: flag, environment variable, `<eval-dir>/run-config.json`,
built-in tier value.

- `EVAL_MAX_COST_USD`: a whole-run ceiling, like `--max-cost-usd`.
- `EVAL_JOBS`: like `--jobs`.
- `run-config.json` sets a tier's ceiling (flat, so it drops `quick`'s per-case scaling), a
  tier's run count, and the default `--jobs`:
  `{"jobs": 4, "tiers": {"standard": {"maxCostUsd": 8, "runs": 4}}}`.

A bad value in an environment variable or in `run-config.json`, an unknown key, or a malformed
file exits 3 rather than falling back, in every layer and every tier, even one a higher layer
overrides. A bad flag, such as `--max-cost-usd 0`, is rejected first and exits 2. Dollar values
are plain decimals from 0.0001 to 1000000, so a printed ceiling is always a valid
`--max-cost-usd` argument; `EVAL_JOBS` and `jobs` must be safe integers. Only a confirmed
missing `run-config.json` falls back to the built-in values. `--dry-run` prints a `config:` line naming
the source of each effective value that is not built in. The default tier is not configurable.

## Pre-approving paid runs

`EVAL_AUTO_APPROVE_MAX_USD` is the user's standing go-ahead for runs whose ceiling is within
it (the `run-evals` skill, "Who may start a run"). `--dry-run` prints `approval: pre-approved`
or `approval: not pre-approved` when it is set, and no `approval:` line when it is not.

The user sets it in `~/.claude/settings.json`. The `run-evals` skill runs without asking only
when it reads the cap from that file and the value equals the one the plan prints. A cap set
only in a shell profile is not honored: a profile can hold the assignment in a branch that
never runs, so the skill cannot tell from its text that the user set the cap, and it asks
instead.

- **Settings file.** Put it under `env` in `~/.claude/settings.json`:
  `{"env": {"EVAL_AUTO_APPROVE_MAX_USD": "5"}}`. The value is a string. Claude Code reads the
  key from the file, so the variable takes effect "no matter how `claude` was launched", and a
  running session applies a saved change ([Claude Code docs: variables in settings
  files](https://code.claude.com/docs/en/env-vars.md#set-variables-in-settings-files)). This
  works for the desktop app, which reads the same settings files ([Claude Code docs: settings
  files](https://code.claude.com/docs/en/settings.md)).
Keep it out of every project file. The `env` key is accepted in any settings file, so a
committed `.claude/settings.json` would grant the cap to everyone who clones the repository,
and a PR could add it; `.claude/settings.local.json` is a file the agent can edit. The wrapper
cannot tell which file a value came from. Review any diff that adds
`EVAL_AUTO_APPROVE_MAX_USD` to a repository.

To confirm the variable arrives, run `--dry-run` once and look for the `approval:` line.

To revoke the approval, remove it from every place that sets it: the key in
`~/.claude/settings.json` and the `export` line in the shell profile. Then start a new
`claude` session. Claude Code does not unset a removed variable in a running session, so the
old value stays in effect there ([Claude Code docs: variables in settings
files](https://code.claude.com/docs/en/env-vars.md#set-variables-in-settings-files)). Deleting
an `export` line does not change a shell that already ran it, and a new `claude` session
started from that shell inherits the value. Run `unset EVAL_AUTO_APPROVE_MAX_USD` in that
shell, or open a fresh terminal, before starting `claude`. In the new session, run `--dry-run`
and confirm no `approval:` line appears.
