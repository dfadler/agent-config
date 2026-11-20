# Existing linters for Claude Code config

Survey for [agent-config#1101](https://github.com/dfadler/agent-config/issues/1101):
three third-party linters for `CLAUDE.md`, skills and related files, compared with
what this repo already runs. Facts come from each project's own README as read on
2026-11-18; none of the tools was installed or run.

## What this repo already checks

| Concern | Existing check |
|---|---|
| Plugin manifests, skill and agent frontmatter, hook files, `plugin-hooks.tsv` | `pnpm run check-plugin-structure` |
| Skill cross-reference contracts | `pnpm run check-skills` |
| `claude/CLAUDE.md` line budget | `pnpm run lint-claude-md` |
| Markdown links | `pnpm run check-links` |
| Eval cases | `pnpm run lint-plugin-evals` |
| Shell, workflows, TypeScript | shellcheck, shfmt, actionlint, eslint, tsc |
| Writing quality of skills and agent files | `agent-writing` skill (AW01-AW24), judged by the model, not a script |

## The candidates

| Tool | Scope | Run | Notes |
|---|---|---|---|
| [cclint](https://github.com/felixgeelhaar/cclint) (MIT, 12 stars) | `CLAUDE.md`, `AGENTS.md`, skills, agents, output styles, rules, settings, `.mcp.json`, plugin manifests; 24 rules | `npx @felixgeelhaar/cclint lint .` | Broadest file coverage. Overlaps `check-plugin-structure` and `lint-claude-md`. |
| [agentlinter](https://github.com/seojoonkim/agentlinter) (MIT, 83 stars) | `CLAUDE.md`, `AGENTS.md`, `SOUL.md`, skills, rules, other agent frameworks; 38+ rules, scored | `npx agentlinter` (no documented path argument; run from the target directory) | README is inconsistent about telemetry ("no telemetry by default" next to an opt-out flag); `--local` is mentioned once, not listed as a command option, so verify it before relying on it. README says v2.3.0 but the npm `latest` is 0.3.3 (modified 2026-02-08), so the README may describe a different build than the one `npx` fetches. Scores are opinionated. |
| [claudelint](https://github.com/pdugan20/claudelint) (MIT, 16 stars) | `CLAUDE.md`, skills, settings, hooks, MCP, plugins | `npm install -g claude-code-lint` | Closest match to this repo's plugin layout (manifest schema, hook scripts exist, skill references). Also ships a Claude plugin. |

The dev.to article in the issue describes running a linter from a `Stop` or
`PostToolUse` hook, with exit code 2 returning errors to the agent. This repo already
does that for eval cases (the `eval-authoring` Stop hook, #1128), so there is nothing
new to adopt there.

## Findings

- Most of what these tools check is already enforced here by scripts that know this
  repo's conventions (`plugin-hooks.tsv`, skill contracts, the setup/teardown drift
  tests). A generic linter would duplicate them and could not check those.
- Possible gaps worth a trial: `settings.json` schema and permission tool names,
  `.mcp.json`, and import resolution in `CLAUDE.md` (`@path` lines). Which tool covers
  these best was not tested.
- All three are small projects with a single maintainer each. Adding one as a CI
  dependency means pinning a package that may stop moving.
- Running any of them is a fetch-and-execute (`npx`), which needs your explicit
  per-run go-ahead (`claude/conventions/fetch-execute-installs.md`).

## Trial results

- **agentlinter 0.3.3** (`npx agentlinter --local`, run once, 2026-11-19): 12 rules
  fired, 0 real gaps, 3 false positives, 9 noise. It flagged existing files as
  missing and "no prompt injection defense" after scanning only 2 files. Network use
  was not monitored. Not worth adopting.
- **claudelint (`claude-code-lint`) 0.10.0** (`claudelint check-all`, plain mode):
  "Checked 10 files across 3 categories (claude-md, settings, mcp). No problems
  found." It did not look at anything under `plugins/` (manifests, hooks, skills), so
  the suspected gaps are untested; it may not recognise this repo's layout. `--strict`
  was not run. It wrote an untracked `.claudelint-cache/` into the repo. Adds nothing
  on this run.
- **cclint 0.25.0** (`lint . --format json`, exit 0, 9s): 69 files, 0 errors, 34
  warnings, 18 infos across 8 rules. 0 real gaps, 0 duplicates of existing checks,
  28 false positives (sibling worktrees' `CLAUDE.md` read as duplicates; demands for
  sections the repo's lean `CLAUDE.md` deliberately omits; "personal information"
  hints), 18 info-level noise. It reads `CLAUDE.md`, `.claude/` and one `plugin.json`
  per plugin, not skill bodies, hooks, scripts or workflows. Adopting it would need
  `monorepo-hierarchy`, `file-location` and `structure` turned off. Not worth it.

None of the three found a gap the existing checks miss.

## Alternatives found (2026-11-20, desk research, none run)

Read from each project's README or registry page, so star counts and activity are
approximate. All are MIT and single-maintainer or small-org unless noted.

| Tool | Covers | Why it might matter |
|---|---|---|
| [`claude plugin validate`](https://code.claude.com/docs/en/plugins-reference#validate-the-manifest) (built in, Claude Code 2.1.328 here) | `plugin.json`, marketplace manifest, skills, agents, commands, hooks and MCP entries, path existence and containment; `--strict`, `--json` | First party and local, no new dependency. **Ran it with `--strict` on all 41 plugins: all pass.** `docs/contributing.md` lists it as a manual step, but no script or workflow runs it. |
| [SchemaStore `claude-code-settings.json`](https://github.com/anthropics/claude-code/issues/11795) | `settings.json` shape, editor-time | Closes the settings gap from the Findings above for editors. Does not warn on every unknown key. |
| [agentskills `skills-ref`](https://agentskills.io/specification) | `SKILL.md` against the open Agent Skills spec | Reference implementation; its README calls it demonstration-only. |
| [agentfile-lint](https://pypi.org/project/agentfile-lint/) (0.11.0, 2026-11-14) | `AGENTS.md`, `CLAUDE.md`, `.claude/rules/`, `SKILL.md`, hooks settings, `.mcp.json` | TOML config with per-rule levels and expiring allowlists; stdlib-only Python. Closest to a rule-by-rule tool this repo could tune. |
| [ctxlint](https://github.com/YawLabs/ctxlint) | Checks `CLAUDE.md` paths and commands against the codebase, cross-file contradictions, dead hooks | The only one found that verifies instructions against the repo. Untested here. |
| [skilldoctor](https://github.com/studiomeyer-io/skilldoctor) | `SKILL.md`, agents, `AGENTS.md`: 17 lint and 8 security rules | The security rules (prompt injection, hidden Unicode) are the part this repo lacks. 1 star. |
| [skill-lint](https://github.com/himself65/skill-lint), [agent-skills-lint](https://github.com/swarmclawai/agent-skills-lint) | `SKILL.md` frontmatter and structure | Overlap `check-plugin-structure` and `claude plugin validate`. |
| [claude-code-json-schema](https://github.com/hesreallyhim/claude-code-json-schema), [marketplace-validator](https://github.com/KeisukeYamashita/claude-code-marketplace-validator) | `plugin.json` and `marketplace.json` schemas | Superseded by the built-in command. |

Not read in depth: agents-lint (two unrelated repos with that name), agent-rules-linter,
and agentlint.app.

## Decision

- **Adopted:** `claude plugin validate --strict` over `plugins/*`, as
  `bash scripts/ci.sh validate-plugins` (part of `check`, and a step in
  `typescript.yml` with Claude Code pinned to 2.1.300, as in `plugin-evals.yml`).
  Off CI it skips when the `claude` CLI is missing; under CI it fails.
- **Not adopted:** cclint, claudelint and agentlinter. The trials above found no gap the
  existing checks miss, and none reads this repo's skill bodies, hooks or scripts.
- **Open:** whether to trial ctxlint (checks `CLAUDE.md` against the repo) or skilldoctor
  (security rules). Each trial needs a per-command go-ahead.
- **Follow-up:** [#1155](https://github.com/dfadler/agent-config/issues/1155) researches
  `claude plugin validate` and where it belongs in the plugin-writing workflow. If a
  suspected gap (`settings.json` schema, `.mcp.json`, `@import` resolution) starts to
  matter, extend `check-plugin-structure` for it.
