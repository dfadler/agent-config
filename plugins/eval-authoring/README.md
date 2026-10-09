# eval-authoring

Helps Claude author, lint, run and diagnose `claude plugin eval` cases
([official docs](https://code.claude.com/docs/en/plugin-evals)) for this repo's plugins.
Design and decisions: [#449](https://github.com/dfadler/agent-config/issues/449). Audience
is this repo for now; the docs are kept short on purpose.

## What a useful eval is

A case is useful when it **can fail** (a scored grader fails without the skill), **tells the
plugin from no plugin** (the two-arm delta is above zero), **gives a stable signal** (explicit
PASS and FAIL conditions, repeated runs agree), **covers the trigger boundary** (prompts that
should and should not fire the skill) and **is proportionate** (free graders first). The lint
checks what a script can; the rest needs a paid run.

## Components

| Component | Role |
|---|---|
| [`scripts/ts/lint/`](scripts/ts/lint/cli.ts) | The single source of the rules (EVAL001 to EVAL021, `--list-rules`). Free, no model calls. Everything else calls it. |
| [`hooks/`](hooks/hooks.json) | PostToolUse hook on `Write\|Edit`: lints after Claude edits a file under a plugin's eval directory and reports findings back as context. Report only, always exits 0, no-ops elsewhere and under `tests/`. |
| [`skills/author-cases`](skills/author-cases/SKILL.md) | Writing cases: graders (free first), mocks, fixtures, should-fire and should-not-fire prompts. |
| [`skills/run-evals`](skills/run-evals/SKILL.md) | Slash command only (paid). Lints, shows the planned commands, then runs the wrapper. |
| [`scripts/ts/run-evals/`](scripts/ts/run-evals/run-evals.ts) | The wrapper: cost tiers `quick` / `standard` / `thorough`, one CLI invocation per case (each under its own grants), a cumulative cost ceiling, preflight checks, never `--scaffold`. |
| [`skills/diagnose-scores`](skills/diagnose-scores/SKILL.md) | Finds the result file and dispatches the diagnoser. |
| [`scripts/ts/diagnose/`](scripts/ts/diagnose/diagnose.ts) | Free per-case verdict from an `aggregate-result.json` (delta, variance, run errors, split judge votes). |
| [`agents/`](agents/) | `case-reviewer` (runs the lint, then judges wording and boundary coverage) and `score-diagnoser` (interprets the script's verdict). Both read-only. |
| [`docs/`](docs/) | [Grants file format](docs/grants-format.md), [adding a lint rule](docs/lint-rules.md). |
| `evals/`, `tests/lint-fixtures/` | The plugin's own model-behavior cases and the lint's free fixtures. |

## Workflow and quick start

`author-cases` (or `claude plugin eval init --bare <name>`), then the lint (the hook does this
on every edit), then `case-reviewer`, then `run-evals`, then `diagnose-scores`.

```bash
node plugins/eval-authoring/scripts/ts/lint/cli.ts plugins/<name>          # free
node plugins/eval-authoring/scripts/ts/run-evals/run-evals.ts --tier quick --dry-run plugins/<name>
node plugins/eval-authoring/scripts/ts/diagnose/diagnose.ts <results-dir>/aggregate-result.json
```

Every script takes `--help` (flags, output, exit codes). CI today runs only the free lint
(`pnpm run lint-plugin-evals`); a gate on paid runs is an open investigation in
[#436](https://github.com/dfadler/agent-config/issues/436), not a finished recipe.

Stable-signal checklist: explicit PASS and FAIL conditions in `llm` criteria, free graders
first, repeated runs agree; split judge votes in `report.html` mean an unstable rubric.

A case cannot grant itself `Bash`, `Write`, `Edit`, `WebFetch` or `WebSearch`; the operator
passes `--allow-tools`, which applies to the whole run. Record each case's grant in
`evals/grants.yaml` (see the [format](docs/grants-format.md)); the wrapper then makes one run
per distinct grant set so a narrow case never inherits a broader grant.

Cost: a run is cases x runs x arms agent runs plus three judge calls per `llm` or `baseline`
grader per run. `quick` runs only cases tagged `quick` (free graders), once, plugin arm only;
`standard` is 3 runs and `thorough` 5, both with the CLI's default arms.
All tiers pass `--threshold 1` (every grader must pass, so one miss fails a case) and a
tier-specific cost ceiling (`quick` scales with the number of cases); see [run-evals](skills/run-evals/SKILL.md#what-the-tier-values-mean).

## Requirements

- Claude Code, git and sandbox requirements: see the
  [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals).
- Node 22.18 or later: the TypeScript scripts run directly with `node`.

## What it cannot do

- `claude plugin eval` needs a logged-in shell. An agent session cannot run paid evals, so
  `run-evals` is a slash command only and agents hand the run to you.
- Neither the lint nor `case-reviewer` can prove a case is useful: whether it can fail and
  shows a delta needs a paid run.
- A plugin cannot ship rules, so guidance lives in the lint's messages and the skills.
- Declared plugin `dependencies` are not resolved inside an eval run (EVAL018,
  [#450](https://github.com/dfadler/agent-config/issues/450)).

## Verified and unverified

Verified without the model: the lint rules and their fixtures, the hook's scope and
report-only behavior, the wrapper's command building (tested with a fake spawner), the
diagnosis verdicts (tested on fixtures shaped from [#450](https://github.com/dfadler/agent-config/issues/450)).

Not confirmed against a logged-in run:

- How several grants reach `--allow-tools` (the wrapper repeats the flag), that
  `--output-dir X` writes `aggregate-result.json` into `X` rather than a subdirectory
  (the wrapper reads both), that a result's `costUsd` is present when a run is partial or
  errored, and what `--json` does (it made the CLI exit 1 in
  [#536](https://github.com/dfadler/agent-config/issues/536); the wrapper no longer passes it).
- That the CLI's "cannot pass with the granted tools" warning appears before authentication
  (the lint keeps EVAL004 and EVAL005 in full until then).
- The `aggregate-result.json` shape the diagnosis reads, including split judge votes parsed
  from grader explanations.
- That the plugin's own cases ([#469](https://github.com/dfadler/agent-config/issues/469))
  pass; none has reached the model yet.
