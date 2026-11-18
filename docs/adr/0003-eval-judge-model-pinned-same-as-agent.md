---
status: proposed
---

# Eval judge model: keep it pinned and equal to the agent model, until a paid A/B says otherwise

**The decision is the owner's.** This records the evidence, the options and a recommendation for [#955](https://github.com/dfadler/agent-config/issues/955). No paid run was made for it.

`DEFAULT_MODEL` and `DEFAULT_JUDGE_MODEL` in `plugins/eval-authoring/scripts/ts/run-evals/tiers.ts` are both `claude-sonnet-5-5`, so the agent under test and the judge of its `llm` and `baseline` graders are the same model. `docs/plugin-eval-ci.md` ("Judge model (#738), open") marks the question open. `docs/eval-baselines/eval-authoring.json` (2026-11-04) was recorded with both at Sonnet 5.5, mean Δ +0.44, so any change of judge moves the baseline and the Δ floor of 0.14 (#736).

## What we know

- The CLI judges only `llm` and `baseline` graders (three votes, PASS needs two) and `type: agent` mocks. `regex`, `tool_used`, `tool_order` and `file_exists` call no judge. [Plugin evals docs](https://code.claude.com/docs/en/plugin-evals): grader types table, "Write graders", `--judge-model` in command options.
- Without `--judge-model` the CLI judges with "the model Claude Code uses for background tasks"; `--judge-model sonnet` or a full ID overrides it (same page). The wrapper pins one so scores do not drift with a CLI default (`tiers.ts`).
- The docs' own advice on a doubtful judge is about size and rubric, not about sameness with the agent: "a small judge model can mark a correct answer wrong because it's formatted differently", so re-run with `--judge-model sonnet` and tighten the rubric. They say nothing on self-preference when judge and agent match. I found no source in the docs or this repo that measures it; the concern is a general one, not shown here.
- Judge scores "compare only at one judge" (`skills/validate-judge/SKILL.md`). Δ is with-plugin minus no-plugin under one judge, so a shared judge bias largely cancels in Δ and does not cancel in the absolute score or the pass bar.
- Reach: 11 of 97 `eval-authoring` cases contain an `llm` grader (`grep -rl "type: llm" plugins/eval-authoring/evals`); the rest are judge-free. Other plugins were not counted.
- Tools exist to measure the judge for free or cheaply: `judge-agreement.ts` (vote splits and unanimity from saved results, agreement, kappa, TPR and TNR against human labels) and `validate-judge` (a small paid probe).

## Options

1. **Keep same model (status quo).** No recalibration, baseline and floor stay valid, one fewer model in the CI bill. Risk: a self-preferring judge could inflate absolute scores; Δ mostly cancels it.
2. **Pin a cheaper, smaller judge (for example Haiku 5.5).** Lower cost per `llm` grader. The docs warn small judges mislabel correct but differently formatted answers, which would depress with-plugin scores, so rubrics would need rework.
3. **Pin a stronger or different-family judge (for example Opus 5.5).** Removes shared-model bias and is likely a stricter reader. Costs more on the 11 judged cases and shifts every judged score, so the baseline and the 0.14 floor must be re-derived.
4. **Do not decide by argument: measure the judge, then decide.** Run `judge-agreement.ts --labels` on saved results and `validate-judge` against human labels for the judged cases, under the current judge. Only if agreement or TNR is poor, run the paid A/B from the issue.

## Recommendation

Option 1 now, with option 4 as the gate for changing it. The judged share is small (11 of 97 cases), Δ is the gated quantity and mostly insensitive to a shared judge, and the evidence for a problem is absent rather than adverse. A change should come from a measured disagreement with human labels, not from sameness alone.

If the owner picks option 2 or 3, the issue's done-when applies: a paid A/B on at least one plugin under both judges with cost recorded in an issue comment, `docs/plugin-eval-ci.md` updated, `docs/eval-baselines/eval-authoring.json` regenerated, and the 0.14 floor rechecked.

## Considered and rejected

- Switching the judge now without the A/B: every score shifts and nothing says in which direction.
- Leaving the CLI default judge: it follows Claude Code's background-task model, so scores drift across CLI versions (`tiers.ts` pins for this reason).
