---
status: proposed
---

# Eval judge model: keep it pinned and equal to the agent model until measured otherwise

**The decision is the owner's.** Evidence, options and the full reasoning are in the [#955 comment](https://github.com/dfadler/agent-config/issues/955#issuecomment); no paid run was made.

`DEFAULT_MODEL` and `DEFAULT_JUDGE_MODEL` in `plugins/eval-authoring/scripts/ts/run-evals/tiers.ts` are both `claude-sonnet-5-5`. Proposed: keep it, and change the judge only if `judge-agreement.ts` or `validate-judge` shows poor agreement with human labels. Only 11 of 97 `eval-authoring` cases have an `llm` grader, and Δ, the gated quantity, mostly cancels a shared judge bias.

A judge change shifts every judged score, so it also needs the paid A/B, a regenerated `docs/eval-baselines/eval-authoring.json` and a recheck of the 0.14 Δ floor (#736).
