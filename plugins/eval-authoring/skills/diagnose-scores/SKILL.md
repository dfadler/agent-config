---
name: diagnose-scores
description: ALWAYS invoke this skill first when asked where to start on an eval case with a negative Delta or a low score on replies that look correct, even when nothing is to hand to run, because it sets the order of suspects (judge first). Explain why an eval case scored low - "my eval fails", "score 0.4", negative or zero Δ, 0.00 on output that looks correct, exit 1 or 2 with fine-looking results. Free, read-only. Not for running evals (run-evals) or writing cases (author-cases).
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/../../scripts/ts/diagnose/diagnose.ts *)
argument-hint: "[results-dir | aggregate-result.json | plugin-path]"
---

# Diagnose eval scores

## Contract

- **Input:** `$ARGUMENTS`: an `aggregate-result.json`, the results directory holding one,
  or a plugin path. With no argument, use the plugin in the working directory.
- **Output:** per case that is not useful, a cause, the evidence and the next step.
- **Does not:** start a paid run, edit cases or the plugin, or compute a Δ, mean or
  verdict itself.

The diagnosis script (`${CLAUDE_SKILL_DIR}/../../scripts/ts/diagnose/diagnose.ts`, run with
`--help`) finds the facts and gives each case a verdict. It is free (no model calls), and its
text output is short enough to read in this context, so no subagent is used. This skill
interprets the verdict.

## Steps

1. **Find the result file.** A file argument is used as given. A directory is searched for
   `aggregate-result.json`. A plugin path means `<plugin>/evals/results/<timestamp>/`:
   take the newest timestamp that has one. Say which file you chose. If none exists, stop
   and say so: a run is needed first, and starting it is the user's call (see the
   [run-evals](../run-evals/SKILL.md) skill).
2. **Run the script:** `node ${CLAUDE_SKILL_DIR}/../../scripts/ts/diagnose/diagnose.ts --format text RESULT.json`
   (Node 22 or later). If it fails, report the error and stop; do not estimate a verdict by
   hand. Never run `claude plugin eval`.
3. **Interpret** each case below, using the script's numbers as given. Read the result file
   only in slices (`jq`, `grep`) for detail the verdict lacks (grader names, which grader
   failed in which arm, `arms.with[].error`, judge explanations); it is verbose. Read the
   case files and the skill under test to name the concrete change.

## Interpretation

- **`run-error`, or 0 across many runs:** read `arms.with[].error`. A usage or rate-limit
  message means the zeros are not a regression. Recommend a re-run after the limit resets;
  do not diagnose the skill from those runs.
- **`negative-delta`:** suspect the judge first. Find the failing `llm` grader in the with
  arm and read its explanation. If the judges disagree (PASS and FAIL votes in one
  explanation), the rubric is unstable: re-run with `--judge-model sonnet` and tighten the
  PASS and FAIL conditions.
- **`negative-delta` with a consistent judge:** if every vote agrees (say 24 of 24 FAIL in
  the with arm) the judge is stable, so re-running it with the same configuration is
  unlikely to move the score (a different `--judge-model` is only a sensitivity check, not a
  fix). Unanimity does not say which side is wrong: the with-arm replies may really
  be worse, or the rubric may consistently reject acceptable replies. Read the judge's
  explanation and a with-arm transcript (or the `mock-recordings/` below) to decide. If the
  replies are worse, the next step is an edit to the skill's text, not to the case; if they
  look right, fix the rubric's PASS and FAIL conditions.
- **`no-discrimination` with a `tool_used: Skill` grader failing in the with arm:** the
  skill's description did not trigger on the prompt. Compare the two and propose a
  description change. If the Skill grader passes and Δ is still about zero, the model does
  this by default: reword the case around what the skill adds, or mark it a regression
  guard in `expected_outcome`.
- **`split-judge-votes`, `high-variance`:** an unstable criterion. Name the grader, the
  condition two judges could read differently, and the rewording.
- **`no-scored-graders`, `no-delta-signal`:** every grader is excluded from scoring
  (`arm: with-only`, `tool_used: Skill` without `arm: both`, mock-calls on plugin mocks) or
  only one arm ran. Name which, and the change (`arm: both`, a free grader that counts, or
  `--ablation` back to two arms).
- **`judge-skipped`:** the cost ceiling skipped paid graders; not a signal. Recommend a higher
  ceiling or a free grader.
- **`weak-signal`:** positive Δ inside noise. Recommend more runs before changing anything.
- **`both-arms-pass-all` / `both-arms-fail-all`:** a case that cannot fail, or never passes
  (check graders and grants).
- **`discriminates`:** one line; do not invent a problem.

Partial results (the script prints `PARTIAL`) are left out of trends; say so.

## Verdict cutoffs

The numbers behind the verdicts, as set in
`plugins/eval-authoring/scripts/ts/diagnose/verdict.ts` (`DEFAULT_THRESHOLDS`). Scores run 0 to 1; Δ is the with-arm mean minus the
without-arm mean over usable runs.

| Verdict | Rule |
|---|---|
| `negative-delta` | Δ ≤ -0.05 |
| `no-discrimination` | -0.05 < Δ < 0.05 |
| `weak-signal` | Δ ≥ 0.05 and Δ ≤ 2 standard errors (only when both arms' standard deviations are known) |
| `discriminates` | Δ ≥ 0.05 and Δ > 2 standard errors; with unknown noise, any Δ ≥ 0.05 |
| `high-variance` finding | an arm's run-score standard deviation is above 0.25 |

The 0.05 band, the 2 standard errors and the 0.25 SD are rules of thumb the script chose,
not measured limits. They may change; `verdict.ts` is the authority.

## Reading `mock-recordings/`

A case with a `type: agent` mock has a model answer as the fake server, so its output varies
between runs. The results directory then holds a `mock-recordings/` folder (with an
`ADOPT.txt`). Open the recordings for the with-arm runs of the failing case and compare:
if the mock answered differently from run to run, the variation came from the mock, not the
skill. Copy the recordings to `mocks/.replay/<server>/` as `ADOPT.txt` says to make runs
repeatable, then re-run
([fixtures and mocks](../author-cases/references/fixtures-and-mocks.md)). If the mock
answered the same every time, look at the transcript instead.

## Output

Per case that is not `discriminates`: **Cause** (one line), **Evidence** (verdict, finding,
and the file, grader or error text you read), **Next step** (smallest change naming the file
to edit, or the one question that settles it). No preamble.

## Sample answer

Illustrative numbers, not from a real run. Script output for one case: `negative-delta: the plugin scores -0.208 below no plugin`;
with-arm mean 0.5, without-arm 0.708. The `llm` grader `friendly_tone` shows `PASS PASS PASS`
in the without arm and `FAIL FAIL FAIL` in every with-arm run.

> **Cause:** the judge is consistent; the with-arm replies are worse (they drop the
> breaking-change guidance in 4 of 6 runs).
> **Evidence:** `negative-delta`, Δ -0.208; `friendly_tone` votes are unanimous in all 6
> with-arm runs (the grader explanations in `aggregate-result.json`).
> **Next step:** edit the skill's output section in `skills/release-notes/SKILL.md` to
> require the breaking-change line; leave the case as is.

## Gotchas

- `claude plugin eval` fails a run below its pass threshold, and the default is strict
  (`1.0`), so exit 1 with scores that look fine is common. A low score and a failed gate
  are different questions; say which one it is.
- Partial or rate-limited runs (exit 7 from the [run-evals](../run-evals/SKILL.md) wrapper)
  are not regressions.
