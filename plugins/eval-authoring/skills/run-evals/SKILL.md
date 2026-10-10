---
name: run-evals
description: Run a plugin's `claude plugin eval` cases at a cost tier. Paid; slash command only.
disable-model-invocation: true
argument-hint: "<plugin-path> [quick|standard|thorough]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts *)
---

# Run a plugin's evals

## Contract

- **Input:** `$ARGUMENTS`: a plugin path, optionally a cost tier (`quick`, `standard`,
  `thorough`) and any other wrapper option (run the wrapper with `--help`).
- **Output:** the lint result, the planned commands (`--dry-run`), then the wrapper's
  own output and exit code, reported as is, plus its paste-ready "Eval results" Markdown.
- **Does not:** start a run you did not ask for, pass `--scaffold`, edit cases or grants,
  re-implement the wrapper's preflight checks, or edit a PR body (`--pr`) without the
  user's confirmation.

A run is paid: cases x runs x arms agent runs, plus three judge calls per `llm` or
`baseline` grader per run. The cost figures `claude plugin eval` reports are
list-price estimates of those model calls, not a bill. This skill is a slash command
only (`disable-model-invocation: true`, see the
[skills docs](https://code.claude.com/docs/en/skills)), so Claude never starts one on its own.

The wrapper is `${CLAUDE_SKILL_DIR}/../../scripts/ts/run-evals/run-evals.ts`, run with
`node` (22.18 or later). It owns tiers, grants, preflight checks and exit codes; call
it, do not rebuild any of that.

## Steps

1. **Pick the tier** (the wrapper holds the flags; do not hand-write `--runs` or
   `--max-cost-usd`):
   - `quick`: cases tagged `quick` (free graders only), one run, plugin arm only. Use
     while iterating on a case.
   - `standard` (default): every case, 3 runs, with and without the plugin. Use before
     merging a change to cases or to the plugin.
   - `thorough`: every case, 5 runs. Use when a `standard` verdict looks noisy, or
     before a release.

   If the user named no tier, use `standard`, and say so.
2. **Lint first** (free, no model calls):
   `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts <plugin-path>`.
   Do not run a paid eval while the lint reports errors; show the findings instead.
3. **Show the plan:** run the wrapper with `--dry-run` and the chosen tier. Tell the
   user the tier's run count and cost ceiling, and the grants it will pass. Grants
   come from `<eval-dir>/grants.yaml` ([format](../../docs/grants-format.md)); each
   case runs in its own CLI invocation (`--case` takes one glob) under exactly its own
   grants. The wrapper never passes `--scaffold`, `--json` or `--report`; it reads
   `aggregate-result.json` from a per-case directory under `<eval-dir>/results/`.
4. **Hand the command to the user.** The run needs a shell where `claude plugin eval`
   can authenticate; an agent session usually cannot (child runs fail with
   `Not logged in`). Give the exact non-dry-run command to run in their own shell.
   Run it from here only if the user asks and the session is logged in.
   To re-run a subset, add `--case <name-or-glob>` (the wrapper filters its own plan, so
   no temp `--eval-dir`). To put the results in a PR, add `--pr <n>`: it prints the exact
   marked block, asks, then replaces the `run-evals` block in the PR body with `gh pr
   edit`. It is off by default, refuses `--dry-run`, and `--yes` skips only the question.
5. **Relay the result.** The run ends with a Markdown summary (per-case with, without and
   delta, tier, models, cost, the command, and the redacted, truncated reply of each
   failed grader); paste it under an "Eval results" heading. Report the wrapper's output and exit code without
   reinterpreting; relay its preflight errors verbatim. Exit codes:
   - `0`: passed, results trustworthy.
   - `1`: below threshold, load failure, or no cases.
   - `2`: wrapper usage error.
   - `3`: bad cases or grants file.
   - `4`: unmet requirement (Claude Code or git too old, sandbox backend, `claude`
     missing, plugin eval unavailable).
   - `7`: **partial or untrustworthy** (cost ceiling hit, credential rejected, a run
     errored, paid graders skipped, a planned case missing from its result, or a
     result that could not be read). Its scores are unreliable; never report it
     as a pass.
   - `20`: internal error. `130` and `143`: interrupted or terminated.

## What the tier values mean

Every tier passes `--threshold 1` (the CLI default is also 1.0). A run's score is the
fraction of its graders that passed, weighted, and a case's score is the mean over its
runs; a case passes when that is at least the threshold, and any case below it makes the
CLI exit 1 ([docs](https://code.claude.com/docs/en/plugin-evals#how-a-case-is-scored)).
So at threshold 1 every grader of a case must pass in every run. `quick` makes one run,
so a single miss fails the case, **including a miss on a half-weight wording regex**:
`weight` changes the score, and any score under 1 fails the case at this threshold.

`--max-cost-usd` is a ceiling on the list-price cost estimate, with no default ceiling
in the CLI. It is checked before each run starts; once spent, nothing further starts,
runs already started finish, and if any run is left unstarted the CLI exits 2 (the
wrapper reports 7, partial). The wrapper sets one ceiling for the whole run: `quick`
gets the larger of $1 and $0.25 per selected case (8 cases: $2; 12: $3), `standard` a
flat $5, `thorough` a flat $15, and `--max-cost-usd` replaces any of these as a total,
never per case. `--dry-run` prints the ceiling and how it was derived. The wrapper makes
one invocation per case, gives each the budget left, adds up each result's `costUsd`,
and stops launching when nothing is left, listing the cases it did not run (exit 7). A
result with no readable `costUsd` is charged the ceiling divided by the number of cases
(capped at what is left), so one cost-less result does not use up the budget. The $0.25
rate comes from logged-in runs ($0.04 to $0.12 a run, judge calls included; derivation in
`tiers.ts`) with about 2x headroom; it is an estimate until a quick run reports real
costs. If a run reports exit 7 with the ceiling hit, its scores are partial: trim the
cases rather than reading them as failures.

## Gotchas

- In worktree-isolated sessions in this repo, a PreToolUse hook blocks Bash commands
  containing the word `eval`. Use the sanctioned terminal tool, or have the user run
  the command. Do not route around the hook with a wrapper script or a renamed path.
