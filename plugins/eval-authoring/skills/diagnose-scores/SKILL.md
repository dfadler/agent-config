---
name: diagnose-scores
description: ALWAYS invoke this skill first when scores already exist and you are asked where to start on an eval case with a negative Delta or a low score on replies that look correct, even when nothing is to hand to run, because it sets the order of suspects (judge first). Explain why an eval case scored low - "my eval fails", "score 0.4", negative or zero Δ, 0.00 on output that looks correct, exit 1 or 2 with fine-looking results. Free, read-only. Not for running evals (run-evals) or writing cases (author-cases).
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
  explanation), the rubric is unstable: tighten the PASS and FAIL conditions, then re-run (paid:
  cases x runs x arms). `--judge-model sonnet` is unmeasured advice, and judge scores
  compare only at the same pinned judge.
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
  this by default: reword the case around what the skill adds, or drop it. Only a
  should-not-fire case is a regression guard (delta 0 by design; say so in `expected_outcome`).
- **`split-judge-votes`, `high-variance`:** an unstable criterion. Name the grader, the
  condition two judges could read differently, and the rewording.
- **`no-scored-graders`, `no-delta-signal`:** every grader is excluded from scoring
  (`arm: with-only`, `tool_used: Skill` without `arm: both`, mock-calls on plugin mocks) or
  only one arm ran. Name which, and the change (`arm: both`, a free grader that counts, or
  `--ablation` back to two arms).
- **`judge-skipped`:** the cost ceiling skipped paid graders; not a signal. Recommend a higher
  ceiling or a free grader.
- **`weak-signal`:** Δ inside noise, positive or negative (a drop within the t cutoff below lands here, not under `negative-delta`). Do not change anything on this case alone: read its replies, and recommend more cases before more runs, because more cases shrink the suite's delta error while more runs only shrink this case's noise. More runs are pointless when both arms have SD 0 (the 0.05 floor sets the bar, so more identical runs cannot change the verdict): then a larger effect or a sharper grader is the lever.
- **`both-arms-pass-all` / `both-arms-fail-all`:** a case that cannot fail (or has almost no headroom, both means at least 0.95: check for a leaked answer, then fix or drop it), or never passes
  (check graders and grants).
- **`discriminates`:** one line; do not invent a problem.

Partial results (the script prints `PARTIAL`) are left out of trends; say so.

Scores regress to the mean: a case picked out because it scored badly once will tend to
score better on the next run with nothing changed, and one picked for a high score will tend
to drop. So a rise on the case you singled out is not evidence for your fix; credit the fix
from the delta over the suite, not from that case's with-arm score. A run that loads only the
plugin under test (the only kind `claude plugin eval` makes) overstates the trigger rate of a
`tool_used: Skill` grader, because no other skill competes for the prompt; the only
competition measurement is a manual run with the real skill set installed.

## Verdict cutoffs

The numbers behind the verdicts, as set in
`plugins/eval-authoring/scripts/ts/diagnose/verdict.ts` (`DEFAULT_THRESHOLDS`). Scores run 0 to 1; Δ is the with-arm mean minus the
without-arm mean over usable runs.

| Verdict | Rule |
|---|---|
| `negative-delta` | Δ ≤ -0.05 and beyond the t cutoff; with unknown noise, any Δ ≤ -0.05 |
| `no-discrimination` | -0.05 < Δ < 0.05 |
| `weak-signal` | \|Δ\| ≥ 0.05 and within the t cutoff; also any Δ ≥ 0.05 when an arm has under two usable runs (noise unknown) |
| `discriminates` | Δ ≥ 0.05 and Δ > the t cutoff, with both arms' standard deviations known |

The t cutoff is the two-sided 95% t quantile at the smaller arm's run count minus one (4.30 at 3 runs, 2.78 at 5, 2 from 31) times the standard error of Δ, floored at 0.05 so two arms with SD 0 do not count as noise-free. The `both-arms-pass-all` finding fires when both arm means are at least 0.95.

Δ is rounded to three decimals before these comparisons, so an exact ±0.05 lands the same way every time.
| `high-variance` finding | an arm's run-score standard deviation is above 0.25 |

The 0.05 band, the t cutoff, the 0.05 SE floor, the 0.95 ceiling and the 0.25 SD are rules of thumb the script chose,
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
to edit, or the one question that settles it). No preamble. When the next step is a re-run,
say it is paid (cases x runs x arms) and hand it to [run-evals](../run-evals/SKILL.md).

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
