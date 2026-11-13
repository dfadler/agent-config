---
name: run-evals
description: Run a plugin's `claude plugin eval` cases at a cost tier, and answer questions about running them - tiers, cost ceilings, concurrency (`--jobs`), speed, setting up evals in CI, exit codes, and writing a PR line from pasted run-evals scores. ALWAYS invoke it first when asked to run, rerun or sweep a plugin's eval cases, take a baseline or a before/after run, or run the `run-evals.ts` wrapper, because it sets the order - lint, dry-run, tier, then the run. Paid; runs only on the user's go-ahead in chat. Not for writing cases (author-cases) or explaining a score (diagnose-scores).
argument-hint: "<plugin-path> [quick|standard|thorough]"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts *)
---

# Run a plugin's evals

## Contract

- **Input:** `$ARGUMENTS`: a plugin path, optionally a cost tier (`quick`, `standard`,
  `thorough`) and any other wrapper option (run the wrapper with `--help`).
- **Output:** the lint result, the planned commands (`--dry-run`), then the wrapper's
  own output and exit code, reported as is, plus its paste-ready "Eval results" Markdown.
- **Does not:** start a run you did not ask for, pass `--scaffold` unless the user asked
  for it in chat (the wrapper's opt-in `--scaffold` flag), edit cases or grants,
  re-implement the wrapper's preflight checks, or edit a PR body (`--pr`) without the
  user's confirmation.

A run is paid: cases x runs x arms agent runs, plus three judge calls per `llm` or
`baseline` grader per run. The cost figures `claude plugin eval` reports are
list-price estimates of those model calls, not a bill.

**Who may start a run.** Only the user's go-ahead. A user who asked for a run in this
conversation ("run the evals now") has given it; do not ask again. Otherwise ask in chat,
stating the tier and cost ceiling, and wait. If they decline or do not answer, step 4
hands the command over instead. No environment variable stands in for the go-ahead. A
session that is not logged in (`claude auth status` fails) hands off either way.

The wrapper is `${CLAUDE_SKILL_DIR}/../../scripts/ts/run-evals/run-evals.ts`, run with
a current `node` (see `.nvmrc`). It owns tiers, grants, preflight checks and exit codes; call
it, do not rebuild any of that.

## Steps

1. **Pick the tier** (the wrapper holds the flags; do not hand-write `--runs` or
   `--max-cost-usd`):
   - `quick`: cases tagged `quick` (free graders only), one run, plugin arm only. Use
     while iterating on a case.
   - `standard` (default): every case, 3 runs, with and without the plugin. Use before
     merging a change to cases or to the plugin.
   - `thorough`: every case, 5 runs. Use before a release. It is the run-count half of a
     delta claim; the other half is about 20 cases (see "A PR line from pasted scores").
     A noisy `standard` verdict is better answered with more cases than more runs; read the
     replies (`--keep-temp`) before paying for `thorough`.

   If the user named no tier, use `standard`, and say so.
2. **Lint first** (free, no model calls):
   `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/lint/cli.ts <plugin-path>`.
   Do not run a paid eval while the lint reports errors; show the findings instead.
3. **Show the plan:** run the wrapper with `--dry-run` and the chosen tier. Tell the
   user the tier's run count and cost ceiling, and the grants it will pass. Grants
   come from `<eval-dir>/grants.yaml` ([format](../../docs/grants-format.md)); each
   case runs in its own CLI invocation (`--case` takes one glob) under exactly its own
   grants. The wrapper passes `--scaffold` only when given its own `--scaffold` flag (opt-in, never a default; it
   runs each case's scaffold_script as you), and never `--json` or `--report`; it reads
   `aggregate-result.json` from a per-case directory under `<eval-dir>/results/`.
   `--keep-temp` keeps run traces and writes `replies/` next to the result: each run's
   final reply and tool calls, redacted, at
   `<eval-dir>/results/run-<time>/replies/<NN>-<case>/<case>/<arm>-<run>.md`.
4. **Run or hand off.** Run it from this session if the user asked for a run in this
   conversation. If they did not (you reached this skill while doing something else), ask
   in chat for a go-ahead, naming the tier and cost ceiling, and wait. If they decline or
   do not answer, give the exact non-dry-run command to run in their own shell and stop.

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
   no temp `--eval-dir`), or `--changed[=<ref>]` to run only the cases touched since
   `<ref>` (default origin's HEAD; mapping rules in `--help`: a skill or agent description
   change reruns every `trigger` case, `scripts/**` reruns the Bash-granted cases, docs
   rerun nothing). An empty diff is exit 0. All or nothing: any changed file that maps to
   no case exits 1 before anything runs, even beside files that did map, unless
   `--changed-allow-empty`, so a CI wiring gap cannot pass silently. The summary's
   `subset:` line names the tier and the finished count; with `--pr` it warns when the
   block it replaces held a full run. The mapping is a heuristic and can miss cases, so
   run the full tier before a release.
   To measure routing against competing skills, add `--neighbours <plugin,...>` (directory
   names of siblings under `plugins/`, each with a `.claude-plugin/plugin.json`; a value
   that is not such a directory, such as a manifest `name` that differs from it, is refused
   with exit 2): it runs only the `trigger` cases against a temp copy of the plugin
   with those plugins loaded beside it through each case's `plugins:` (the CLI has no flag
   for this; committed cases are not edited, and a case with its own `plugins:` is
   refused). The summary then has a Trigger set table: fire rate, false-fire rate and
   description length per skill. It always runs the plugin arm only (`--ablation none`
   whatever the tier), because the CLI's baseline arm ignores `plugins:` and loads no
   plugin at all, neighbours included (seen in a paid run, #884): a delta would compare
   the skill with nothing, not with its neighbours, so there is no without or delta column.
   The table covers only the plugin under test's skills: a neighbour that wins a prompt
   shows as the plugin's skill not firing, so grade it with a `tool_used` grader on the
   neighbour's skill, whose id is `<manifest name>:<skill directory name>` (a differing
   frontmatter `name` is ignored; seen, #884). Neighbour hooks run inside the eval as you,
   with no separate trust step: a neighbour's SessionStart, UserPromptSubmit and
   PreToolUse hooks fired, the context they injected reached the model, and a PreToolUse
   `deny` blocked the plugin's own tool call (seen, #884), so a neighbour's hook can change
   a case's score. The plugin under test has no home advantage: with two near-identical
   descriptions and a prompt that echoes neither, the same skill won 5 of 5 runs whether
   it was the plugin under test or the neighbour (seen, #884), so a 0 fire rate in the
   table can mean a tied neighbour won, not a weak description. `node_modules` is not
   copied.
   To measure the should-not-fire side of routing, run `--trigger-boundary`: the cases
   tagged `trigger-boundary` plus the should-fire twin each names with a `pair:<case>`
   tag, one run each, plugin arm only, fixed tier (a ceiling scaled like `quick`; not
   combined with `--tier`, `--neighbours`, `--changed` or `--case`). The summary counts how many
   negative prompts fired and gives a Wilson 95% upper bound on the over-trigger rate,
   withheld (and exit 7) unless at least one twin fired in the same run; a fire alone does
   not change the exit code. Report the count and the bound, not a delta, and list the
   firing prompts so one can become a `smoke` guard. `standard` and `thorough` skip these
   cases: a must-not-fire check passes the no-plugin arm by construction. It does not
   measure competition from other installed skills: the sandbox loads only the plugin
   under test.
   To put the results in a PR, add `--pr <n>`: it prints the exact
   marked block, asks, then replaces the `run-evals` block in the PR body with `gh pr
   edit`. It is off by default, refuses `--dry-run`, and `--yes` skips only the question.
5. **Relay the result.** The run ends with a Markdown summary (per-case with, without and
   delta, tier, models, cost, the command, and the redacted, truncated reply of each
   failed grader; plus a "Delta not significant below 20 cases" footer when the suite is
   smaller than that, see below); paste it under an
   "Eval results" heading. A "Ceiling:" line lists the cases at or above 0.95 in both
   arms: those tagged `probe` or `smoke` are "held as labelled" (a safety probe holding is
   the expected result, not a failure to discriminate); the rest are unlabelled and
   cannot tell the plugin from no plugin, so rewrite or drop them. Quote the line in the PR. Report the wrapper's output and exit code without
   reinterpreting; relay its preflight errors verbatim. Exit codes:
   - `0`: passed, results trustworthy.
   - `1`: below threshold, load failure, no cases, untrusted directory, or invalid option.
   - `2`: wrapper usage error.
   - `3`: bad cases or grants file.
   - `4`: unmet requirement (Claude Code or git too old, sandbox backend, `claude`
     missing, plugin eval unavailable).
   - `7`: **partial or untrustworthy** (cost ceiling hit, credential rejected, a run
     errored, paid graders skipped, a planned case missing from its result, or a
     result that could not be read). Its scores are unreliable; never report it
     as a pass.
   - `20`: internal error. `130` and `143`: interrupted or terminated.

   When a case ran, the wrapper records each case's `resultDir` in
   `run-evals-summary.json` in this run's `<eval-dir>/results/run-<time>/` directory. If that
   `resultDir`'s `aggregate-result.json` shows a negative delta or a score that does not
   match the replies, go to the free [diagnose-scores](../diagnose-scores/SKILL.md) skill on
   that file before any paid re-run, never on an older file under `results/`. When no case ran
   (an untrusted directory, an invalid option, no cases), nothing is written: read the wrapper
   output and run the eval-authoring lint instead.

   **A plugin outside the wrapper's `plugins/`** (a consumer repo's own plugin, say). The wrapper
   passes `--trust-plugin` on its own only for a plugin directly under its own `plugins/`,
   because trust runs the plugin's code as you; for any other plugin the run exits `1` with no
   results. Ask the user to confirm in chat that the plugin's code is trusted, then add the
   wrapper's own `--trust-plugin` flag to the dry-run and the run: the lint, tier, cost ceiling
   and suite summary all still apply. Never add the flag unprompted, and never bypass the
   wrapper with a raw `claude plugin eval --trust-plugin` command. `--scaffold` and
   `--neighbours` stay repo-only: they exit `2` for such a plugin, even with `--trust-plugin`.

**A PR line from pasted scores.** When the user quotes scores and wants a delta in the PR,
and the scores are `quick` or 3-run (`standard`) or the suite has fewer than about 20 cases,
give the arm scores and write "delta not measured": no delta number, even marked
preliminary or with a caveat beside it. More runs alone do not fix this: they shrink
within-case noise, while the error of a delta also depends on how many cases there are. A delta
needs a with-and-without comparison at `thorough` on a suite of about 20 cases or more. The
wrapper's summary says the same under its table. The `± band (n runs/arm)` it prints beside a
`thorough` case delta is that one case's 95% noise bar (t quantile x standard error of the
difference): a delta inside it is noise-level. A delta from fewer than 5 usable runs in an
arm (for example after errored runs are dropped) is also marked `provisional`: rerun with
more runs before quoting it. Neither mark lifts the suite-size rule above.

**Before paying: what can this plan detect?** `node scripts/ts/run-evals/power.ts --runs 5
--sd 0.25` (or `--from-result <aggregate-result.json>` for the SD pooled over an earlier
run's arms) prints the smallest per-case delta that clears the same 95% bar, so "5 runs
cannot see a delta under 0.44" is known before the run. There is no default SD (none is
recorded for this repo), so the figure is only as good as the SD you give it (a result full
of ceiling or floor cases pools in SD 0 and gives an optimistic cutoff). It is a
cutoff, not a power calculation: a true delta of that size clears the bar about half the
time. `--cases N` adds the smallest suite-mean delta over N cases (per-case SE over
sqrt(N), same 95% bar): a cutoff that assumes independent cases and ignores how much true
deltas differ between them, so it does not replace the 20-case rule above. `--dry-run`
prints the same cutoff for a two-arm tier as "smallest detectable
delta at N runs: X (SD S from ...)", plus the suite-mean line over the planned cases, with the SD from `--sd S` or pooled from the newest
run under `<eval-dir>/results/`; with neither it says so and shows the `power.ts` command
rather than guess an SD.

## What the tier values mean

`quick`, `standard` and `thorough` pass `--threshold 1` (the CLI default is also 1.0;
`--trigger-boundary` passes 0). It was chosen so one failed
grader is never averaged away; that is a design choice (see
[plugin-eval-ci.md](../../../../docs/plugin-eval-ci.md)), not a measured optimum. A run's score is the
fraction of its graders that passed, weighted, and a case's score is the mean over its
runs; a case passes when that is at least the threshold, and any case below it makes the
CLI exit 1 ([docs](https://code.claude.com/docs/en/plugin-evals#how-a-case-is-scored)).
So at threshold 1 every grader of a case must pass in every run. `quick` makes one run,
so a single miss fails the case, **including a miss on a half-weight wording regex**:
`weight` changes the score, and any score under 1 fails the case at this threshold.

`--max-cost-usd` is a ceiling on the list-price cost estimate (the CLI has no default). The
wrapper sets one total ceiling per run: `quick` the larger of $1 and $0.25 per selected case,
`standard` $5, `thorough` $15; `--max-cost-usd` replaces it as a total. `--dry-run` prints
the ceiling and how it was derived. Once spent, nothing further starts and the wrapper lists
the cases it did not run (exit 7): trim the cases rather than reading partial scores as
failures.

## Run in your repo (CI)

- Workflow: `.github/workflows/plugin-evals.yml` (manual `workflow_dispatch` with a `plugin`
  input; the weekly run is a local scheduled task; never `pull_request`).
- Secret: `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), in the
  `plugin-evals` environment the workflow selects.
- It runs the `standard` tier through the wrapper, then gates on the exit code and on the mean
  delta of the whole plugin (floor 0.14, a failure at 16 or more cases with a delta, a warning
  below). Why and what fails: [plugin-eval-ci.md](../../../../docs/plugin-eval-ci.md).

## Faster feedback

Levers, biggest first. A run is cases x runs x arms agent runs; `--dry-run` prints the run
count and the cost ceiling before you pay.

1. **Raise concurrency (`--jobs N`).** The wrapper passes `-j N` (1 to 8; the CLI default
   is 1) to each case's invocation, so the runs inside a case go in parallel. The wrapper
   runs cases one after another, so this is the only concurrency. CI passes 6.
2. **Target one case.** `--case <name-or-glob>` runs only the matching cases.
3. **Skip the baseline arm.** `--no-baseline` runs any tier plugin arm only (raw:
   `--ablation none`), as `quick` does for the cases tagged `quick`. The without arm was 37% of
   the cost of the stored runs, and it drops the without and Δ columns: use it to see a
   with-arm score rise after a cause-file or grader fix, never to claim a delta.
4. **Reuse the stored baseline (automatic).** A finished two-arm run stores each case's without
   arm under `evals/results/.baseline-cache`. The next two-arm run with the same case files,
   suite mocks, `.mcp.json`, grants, runs, threshold, model, judge model and `claude --version` runs that case plugin arm only and
   splices the stored arm in, so a skill or agent edit re-pays only the plugin arm. That
   without score is one earlier sample, not a fresh draw (the summary lists those cases, and
   a delta against it is not a same-run delta): say so if you quote it, or redraw it with
   `--no-cache`. `--dry-run` shows hit or miss per case. Off for
   `--no-cache`, `--no-baseline`, `--neighbours` and `--trigger-boundary`; empty in CI.
5. **Fewer runs.** `quick` makes one run per case. At 3 runs a swing on one case is often
   noise: the `±` band beside a `thorough` delta, or `power.ts` (above), gives the cutoff.

| Goal | Command |
|---|---|
| Iterate on one case | `run-evals.ts --tier quick --jobs 4 <plugin> --case <name>` |
| Pre-merge | `run-evals.ts --tier standard --jobs 4 <plugin>` (`thorough` for a release or a delta claim) |

All child runs share your Claude rate limit. If runs fail or stall, lower `--jobs` by 1 or 2;
a burst of sessions started close together can also throttle briefly.

## Gotchas

- In worktree-isolated sessions in this repo, a PreToolUse hook blocks Bash commands
  containing the word `eval`. It may also refuse compound commands (`$VAR`, globs, `for`
  loops, multi-file heredocs, some pipes). Use the sanctioned terminal tool, single plain
  commands and the Write tool, or have the user run the command. Do not route around the
  hook with a wrapper script or a renamed path.
