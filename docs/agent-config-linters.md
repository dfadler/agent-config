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
| [agentlinter](https://github.com/seojoonkim/agentlinter) (MIT, 83 stars) | `CLAUDE.md`, `AGENTS.md`, `SOUL.md`, skills, rules, other agent frameworks; 38+ rules, scored | `npx agentlinter` | README is inconsistent about telemetry ("no telemetry by default" next to an opt-out flag); `--local` is said to make no network calls. Scores are opinionated. |
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

## Recommendation (owner's call)

Do not adopt a linter yet. If you want to close the gaps above, the smallest trial is
a one-off local run of claudelint (`claudelint check-all`) against this repo, to see
whether it finds anything the existing checks miss. Adopt into CI only if it does, and
pin the version. Otherwise extend `check-plugin-structure` for the specific gap.
