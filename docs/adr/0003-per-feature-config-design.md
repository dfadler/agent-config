# Per-feature enable/disable: one config file, built in three steps (proposed)

Status: proposed design for #1122. Nothing is built yet; this records the
decisions so the work can be split into small PRs.

## Today

- Plugins and commands: whole-name `setup.sh --skip=` / `--include=`.
- Conventions: per file, `DEFAULT_ENABLED` plus `~/.claude/agent-config.conventions`
  (written by `--include`/`--skip`).
- Hooks and skills: no switch. A plugin is symlinked into `~/.claude/skills/<name>`
  as a unit (`docs/plugin-loading.md`), so its skills, agents and hooks come and go
  together. The only per-hook knobs are ad hoc env vars (`SCRATCH_GUARD`).

## Decision

1. **Format: JSON, in `~`.** `~/.claude/agent-config.json`, absent means shipped
   defaults. JSON because the scripts are TypeScript and bash tooling already
   parses it (`jq`); TOML would add a parser dependency. No per-project file in v1.
2. **Shape: a flat map of feature ID to a boolean or a mode string.**

   ```json
   { "features": {
       "plugin/adversarial-review": false,
       "hook/pii-cleanup/commit-gate": false,
       "skill/eval-authoring/mine-cases": false,
       "convention/background-tasks": true,
       "hook/scratch-guard": "block"
   } }
   ```

   IDs: `plugin/<n>`, `command/<n>`, `convention/<n>`, `skill/<plugin>/<n>`,
   `agent/<plugin>/<n>`, `hook/<plugin>/<n>`. A parent set to `false` wins over
   its children. Allowlist mode stays the existing `--include`, which writes
   `false` for every other feature rather than adding a second config syntax.
3. **Realization of a disabled child: gate at runtime, not at link time.**
   Filtering at link time would mean linking a plugin as a partial copy, which
   breaks "edits are live" and the unit-symlink design. Instead:
   - hooks: the hook entrypoint checks its own feature ID against the config
     first and exits 0 when off (one shared helper, so each hook adds one line);
   - skills and agents: the hard case. Checked against the Claude Code docs on
     2026-11-19: the `skillOverrides` setting does not apply to plugin skills
     ([skills](https://code.claude.com/docs/en/skills), "Override skill
     visibility from settings"), and no per-component switch exists for a
     plugin's skills or agents. Two routes are left, both untested:
     - a `Skill(<plugin>:<skill>)` deny rule written into settings (the docs
       describe `Skill(name)` rules but do not confirm the namespaced form);
     - narrowing the `agents` list in `plugin.json`
       ([plugins-reference](https://code.claude.com/docs/en/plugins-reference),
       "How each key combines with its default location"), which edits the
       repo's own manifest, so it is per-checkout, not per-user.
     Step 3 starts by testing the deny rule on one skill. If it fails, the
     issue's first acceptance line is narrowed to hooks, conventions, commands
     and plugins.
4. **One reader.** A single script (`scripts/features.ts`) resolves
   flags + legacy conventions file + JSON into one effective state. `setup.sh`,
   `upgrade.sh`, `doctor.sh`, `teardown.sh`, `--list-features` and `--plan` call
   it, which is what `scripts/tests/lifecycle-drift.bats` should then enforce.
5. **Migration:** `agent-config.conventions` is read as `convention/*` entries
   when the JSON has none, and rewritten into the JSON on the next `setup.sh`
   run. `--skip`/`--include` keep their current meaning and write into the JSON.
   Env-var knobs (`SCRATCH_GUARD`) stay as an override above the file.

## Build order (each its own PR)

1. `scripts/features.ts` + JSON file for plugin, command and convention IDs,
   `--list-features` showing state, `--plan`, migration, doctor drift. No
   behavior change with no file.
2. Hook gating helper and `hook/*` IDs, mode strings for existing knobs.
3. Skill/agent toggles, only if the deny-rule test above works.

Tests per step: defaults with no file, one child off under an enabled plugin,
migration from the existing flags and conventions file.

## Considered Options

- TOML: rejected, new parser for no gain.
- Link-time filtering of skills/hooks: rejected, breaks unit symlinks and live edits.
- Per-project file in v1: deferred, the user file must work first.
