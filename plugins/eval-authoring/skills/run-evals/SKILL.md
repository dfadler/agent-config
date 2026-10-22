---
name: run-evals
description: Run a plugin's `claude plugin eval` cases at a cost tier, and answer questions about running them - tiers, cost ceilings, concurrency (`-j`), speed, setting up evals in CI, exit codes, and writing a PR line from pasted run-evals scores. Paid; needs an explicit request to run (or EVAL_ALLOW_AGENT_RUNS=1). Not for writing cases (author-cases) or explaining a score (diagnose-scores).
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
list-price estimates of those model calls, not a bill.

**Who may start a run.** An agent session may run it when the user asked for a run in
this conversation ("run the evals now"), or when `EVAL_ALLOW_AGENT_RUNS=1` is set (for
example in the project's `.claude/settings.json` env block) for unattended use where
nobody is asking. With neither, step 4 hands the command to the user instead. A session
that is not logged in (`claude auth status` fails) hands off either way.

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
   - `thorough`: every case, 5 runs. Use before a release, or to back a delta claim. A
     noisy `standard` verdict is better answered with more cases than more runs; read the
     replies before paying for `thorough`.

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
4. **Run or hand off.** Run it from this session if the user asked for a run in this
   conversation, or `EVAL_ALLOW_AGENT_RUNS` is exactly `1`
   (`[ "${EVAL_ALLOW_AGENT_RUNS:-}" = "1" ] && echo yes || echo no`; `0`, `true` and
   empty do not count). The request, not the variable, is the opt-in when someone is
   asking. If neither holds (you reached this skill while doing something else), give the
   exact non-dry-run command to run in the user's own shell and stop. Tell them they can
   ask you to run it, or set `EVAL_ALLOW_AGENT_RUNS=1` (e.g. in `.claude/settings.json`
   env block) for unattended runs.

   Before starting, check login with `claude auth status`; child runs fail with
   `Not logged in` otherwise. Hand the command to the user only if that check fails.
   Do not assume a session cannot authenticate: check. Make progress visible: start it
   in the background (`run_in_background`) with its output going to a file, never piped
   through `tail`, `head` or `grep`, which hide everything until the command exits. Tell
   the user the output path (or the terminal tab) as soon as it starts, then read that
   file to report progress. The file shows the live output of the wrapper and the
   `claude plugin eval` child it runs, not proof that a case finished or passed: take
   completion and the verdict from the final summary and exit code only. Do not edit the
   plugin under test while a run is in flight: the plugin arm loads its files live. Run
   silently (foreground, summary only) only if the user asks for a silent run.
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

**A PR line from pasted scores.** When the user quotes `quick` or 3-run (`standard`)
scores and wants a delta in the PR, give the arm scores and write "delta not measured":
no delta number, even marked preliminary. A delta needs a with-and-without comparison at
`thorough`. The wrapper's summary says the same under its table.

## What the tier values mean

Every tier passes `--threshold 1` (the CLI default is also 1.0). It was chosen so one failed
grader is never averaged away; that is a design choice (see
[plugin-eval-ci.md](../../../../docs/plugin-eval-ci.md)), not a measured optimum. A run's score is the
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

## Run in your repo (CI)

- Workflow: `.github/workflows/plugin-evals.yml` (manual `workflow_dispatch` with a `plugin`
  input; the weekly run is a local scheduled task; never `pull_request`).
- Secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), in the
  `plugin-evals` environment the workflow selects.
- It runs the `standard` tier through the wrapper, then gates on the exit code. Why and what
  fails: [plugin-eval-ci.md](../../../../docs/plugin-eval-ci.md).

## Faster feedback

Levers, biggest first. Times and costs are rough figures from one 9-case plugin
(`--runs 5 -j 3` = 90 runs, ~16 min, ~$10); yours will differ.

1. **Raise concurrency (`-j`).** More runs in parallel: `-j 6` took that suite to ~8 min;
   `-j 9` is likelier to hit rate limits. The wrapper has no `-j` flag, so this lever is
   the raw `claude plugin eval <plugin> --runs 5 -j 6` command, not a tier.
2. **Target one case.** `--case <name>` on the wrapper (or the case directory as the
   target of the raw command) runs that case only: 10 runs instead of 90.
3. **Skip the baseline arm.** The wrapper's `quick` tier is plugin arm only (raw:
   `--ablation none`). It halves the runs but drops the Δ column: use it to see a
   with-arm score rise after a cause-file or grader fix, never to claim a delta.
4. **Fewer runs (`--runs 3`).** A directional smoke test (~54 runs, ~6 min, ~$6 on the
   suite above). At 3 runs a 0.20 swing is noise.

| Goal | Command | Est. |
|---|---|---|
| Iterate on one case | `run-evals.ts --tier quick <plugin> --case <name>` (raw: `<case-dir> --runs 3 --ablation none -j 5`) | ~1 min, ~$0.70 |
| Full suite, pushed | raw: `<plugin> --runs 5 -j 6` | ~8 min |
| Pre-merge | `run-evals.ts --tier thorough <plugin>` (raw: `--runs 5 -j 6`) | ~8 min |

Only `-j 3` (16 min) and `-j 6` (8 min) were timed; the `-j 5` in the first row is a guess
(a one-case run has too few runs to use it), and `-j 9` is untested. The wrapper sets no `-j`.

All child runs share your Claude rate limit. If runs fail or stall, drop `-j` by 1 or 2;
a burst of sessions started close together can also throttle briefly.

## Gotchas

- In worktree-isolated sessions in this repo, a PreToolUse hook blocks Bash commands
  containing the word `eval`. Use the sanctioned terminal tool, or have the user run
  the command. Do not route around the hook with a wrapper script or a renamed path.
