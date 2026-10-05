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
  own output and exit code, reported as is.
- **Does not:** start a run you did not ask for, pass `--scaffold`, edit cases or grants,
  or re-implement the wrapper's preflight checks.

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
   come from `<eval-dir>/grants.yaml` ([format](../../docs/grants-format.md)), one
   run per distinct grant set, and a grant applies to every case in that run. The
   wrapper never passes `--scaffold`.
4. **Hand the command to the user.** The run needs a shell where `claude plugin eval`
   can authenticate; an agent session usually cannot (child runs fail with
   `Not logged in`). Give the exact non-dry-run command to run in their own shell.
   Run it from here only if the user asks and the session is logged in.
5. **Relay the result.** Report the wrapper's output and exit code without
   reinterpreting; relay its preflight errors verbatim. Exit codes:
   - `0`: passed, results trustworthy.
   - `1`: below threshold, load failure, or no cases.
   - `2`: wrapper usage error.
   - `3`: bad cases or grants file.
   - `4`: unmet requirement (Claude Code or git too old, sandbox backend, `claude`
     missing, plugin eval unavailable).
   - `7`: **partial or untrustworthy** (cost ceiling hit, credential rejected, a run
     errored, or paid graders skipped). Its scores are unreliable; never report it
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
wrapper reports 7, partial). The ceiling applies to one CLI invocation, and the wrapper
makes one per distinct grant set. The docs give no per-run price; the CLI's `--help`
says the same, so whether `quick`'s $1 covers your suite is not known before a run. If a
run reports exit 7 with the ceiling hit, its scores are partial: trim the cases (`--case`)
rather than reading them as failures.

## Gotchas

- In worktree-isolated sessions in this repo, a PreToolUse hook blocks Bash commands
  containing the word `eval`. Use the sanctioned terminal tool, or have the user run
  the command. Do not route around the hook with a wrapper script or a renamed path.
