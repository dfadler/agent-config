# Plugin evals in CI

Decision record for [#436](https://github.com/dfadler/agent-config/issues/436). Full research and the per-question rationale are in the
[recommendation comment](https://github.com/dfadler/agent-config/issues/436#issuecomment-5940264329);
CLI facts are from the [plugin-evals docs](https://code.claude.com/docs/en/plugin-evals).

Workflow: `.github/workflows/plugin-evals.yml` (#582); result checker: #583. Recommendation:

- **Trigger:** `workflow_dispatch` first, then a weekly `schedule`. Never `pull_request` (public repo, `--trust-plugin`, paid key).
- **Scope:** plugins that have `evals/` (today `fetch-execute-guide`), one matrix entry each, after #442 removes vacuous cases.
- **Gate:** hard-fail on the CLI exit code with an explicit `--threshold` (start 0.8). Δ is warn-only, and a missing `delta` means "no signal".
- **Pinned:** `--model`, `--judge-model`, `--ablation with-without`, `--max-cost-usd 5`, `--no-publish`, `-j 1`.
- **Invalid runs:** exit 2, `partial: true`, `skippedPaidGraders`, or any `arms.with[].error` fail the job as inconclusive, not as a regression.
- **Auth:** `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, a one-year token for a Pro, Max, Team or Enterprise plan) in a protected `plugin-evals` environment, per the [authentication docs](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token). Replaces the earlier spend-capped `ANTHROPIC_API_KEY` plan. Consequences:
  - Runs count against the plan's usage limits, shared with interactive use. `--max-cost-usd` is a list-price ceiling, not a spend cap.
  - A run that hits the usage limit scores 0 and is not marked `partial` ([troubleshooting](https://code.claude.com/docs/en/plugin-evals)); the checker treats an `arms.with[].error` as inconclusive, so it shows as exit 7, not a regression.
  - The token expires after a year: rotate the secret. Anyone who can read it can use the plan, so keep it in the protected environment with required reviewers and never expose it to `pull_request` runs.
  - The plugin-evals page documents `ANTHROPIC_API_KEY` for CI and says eval uses "the same authentication" as normal sessions; it does not name `CLAUDE_CODE_OAUTH_TOKEN`. Confirm with one `workflow_dispatch` run before relying on the schedule.
- **Concurrency:** `group: plugin-evals`, `cancel-in-progress: false`.

Follow-ups: the workflow, a TypeScript result checker under `scripts/ts/`, baseline calibration, and later promoting Δ to a gate.
Open owner questions (weekly spend, a capped key, Δ floor) are listed in the comment.
