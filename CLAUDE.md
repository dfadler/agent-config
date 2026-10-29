# Project instructions: agent-config

Repo-specific mechanics for this repo. See `~/.claude/CLAUDE.md` (sourced from
`claude/CLAUDE.md` in this repo) for the general conventions these build on.

## Pull request labels

Do NOT apply any labels when creating PRs in this repo. This repo has no PR label taxonomy and the global label instructions do not apply here.

## Issue tracker
GitHub Issues

- Before writing, changing, or debugging anything under `.github/workflows/`, read
  `docs/github-actions.md` — SHA-pinning, composite-action-vs-reusable-workflow
  judgment calls, the debugging escalation order, and known failure patterns already
  hit and resolved here.

- Changing a hook, plugin or skill path that `setup.sh` registers or links? Check it against `setup.sh`, `upgrade.sh`, `doctor.sh` and `teardown.sh`; `scripts/tests/lifecycle-drift.bats` and `check-plugin-structure` (hook table vs disk) catch drift.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
