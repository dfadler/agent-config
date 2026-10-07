# Plugin evals in CI

Decision record for [#436](https://github.com/dfadler/agent-config/issues/436). Full research and the per-question rationale are in the
[recommendation comment](https://github.com/dfadler/agent-config/issues/436#issuecomment-5940264329);
CLI facts are from the [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals).

Not implemented yet. Recommendation:

- **Trigger:** `workflow_dispatch` first, then a weekly `schedule`. Never `pull_request` (public repo, `--trust-plugin`, paid key).
- **Scope:** plugins that have `evals/` (today `fetch-execute-guide`), one matrix entry each, after #442 removes vacuous cases.
- **Gate:** hard-fail on the CLI exit code with an explicit `--threshold` (start 0.8). Δ is warn-only, and a missing `delta` means "no signal". The checker has an opt-in `--delta-floor F` (#585) that turns a case with `delta < F` into a regression; the workflow does not pass it until #584 baselines set F.
- **Pinned:** `--model`, `--judge-model`, `--ablation with-without`, `--max-cost-usd 5`, `--no-publish`, `-j 1`.
- **Invalid runs:** exit 2, `partial: true`, `skippedPaidGraders`, or any `arms.with[].error` fail the job as inconclusive, not as a regression.
- **Auth:** dedicated spend-capped `ANTHROPIC_API_KEY` in a protected `plugin-evals` environment.
- **Concurrency:** `group: plugin-evals`, `cancel-in-progress: false`.

Follow-ups: the workflow, a TypeScript result checker under `scripts/ts/`, baseline calibration, and later promoting Δ to a gate.
Open owner questions (weekly spend, a capped key, Δ floor) are listed in the comment.
