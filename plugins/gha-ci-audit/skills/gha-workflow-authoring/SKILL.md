---
name: gha-workflow-authoring
description: >
  Rules for writing, editing, hardening and debugging GitHub Actions workflow files. ALWAYS invoke this skill before creating or changing any file under `.github/workflows/` (or a composite action under `.github/actions/`), and when a workflow run is failing and the cause is not yet known. It supplies the SHA-pinning, composite-action-vs-reusable-workflow, `timeout-minutes`, least-privilege `permissions:` and log-debugging escalation rules, runs `actionlint` after the edit, and keeps a human on the merge button for the PR. Not for auditing CI cost or speed (use gha-ci-audit) and not for CI systems other than GitHub Actions.
---

# GitHub Actions workflow authoring

## Contract

- **Input:** the workflow change to make (new file, edit, or a failing run to debug) in the
  working repo.
- **Output:** the edited workflow files, a clean `actionlint` result (or the reason it could
  not run), and a hand-off note that the PR touches `.github/workflows/` and needs a human to
  merge.
- **Does not:** audit CI cost or speed (`gha-ci-audit`), approve or merge the PR, or change
  repo-level Actions settings.

## Steps

1. **Read the repo's own guide first.** If `docs/github-actions.md` exists, read it and let it
   override the defaults below; the rules here are the portable core. Also read the neighbouring
   workflows so the change matches their conventions.
2. **Write the change** against the rules below.
3. **Run `actionlint`** on every edited workflow (`actionlint .github/workflows/<file>.yml`, or
   plain `actionlint` for the whole directory). Fix every finding. If it is not installed, say
   so and name `actionlint` as the check still owed; do not skip silently or install it by
   piping a download into a shell.
4. **Hand the PR to a human.** A PR that touches `.github/workflows/` is security-critical: do
   not approve it, enable auto-merge, or run `gh pr merge`. Open it, report CI, and stop. This
   holds whether or not the github-pr plugin, which states the same rule, is installed.

## Rules

- **SHA-pin every external `uses:`** (`owner/repo@<40-char sha> # vX.Y.Z`), never a tag or
  branch. Local `./.github/...` references take no `@ref` and need no pin. Resolve a tag with
  `gh api repos/<owner>/<repo>/git/refs/tags/<tag>`; if `object.type` is `tag` (annotated),
  dereference via `git/tags/<sha>` to get the commit SHA. Never guess or copy a SHA from a UI.
- **Set `timeout-minutes` on every job** that runs on a runner (a hung setup step otherwise
  runs to the 6-hour default). Callers of a reusable workflow cannot set it.
- **Least-privilege `permissions:`.** Top-level `contents: read`, widened per job only where
  needed. A `permissions:` block replaces the default, so re-declare `contents: read` in a job
  that adds a write scope.
- **Composite action vs. reusable workflow.** A composite action shares a *step sequence*
  repeated verbatim in two or more workflows. A reusable workflow (`workflow_call`) shares a
  *multi-job pipeline* several triggers need identically. Below that break-even point, accept
  the duplication. `env:` does not cross a `workflow_call` boundary; called workflows declare
  their own `env:` and no `concurrency`.
- **Call the same command a human runs locally** (a script or make target) instead of
  re-implementing the check inline in YAML.
- **Verify downloads.** Check a release binary's checksum against the publisher's manifest
  before extracting; never pipe a download into a shell or `tar`.
- **Scope triggers and concurrency.** Use `paths:` only on non-required checks (a path filter
  leaves a required check Pending). Use `concurrency` with `cancel-in-progress: true` for
  PR-triggered runs.

## Debugging a failing run

Escalate in this order; stop at the first step that explains it.

1. `gh pr checks` / `gh run view <run-id> --log-failed`.
2. `gh api repos/<owner>/<repo>/actions/runs/<run-id>/jobs` for per-step status and timing.
3. `gh run rerun <run-id> --debug --failed` (not permanent `ACTIONS_STEP_DEBUG` secrets).
4. `gh run watch <run-id> --compact --exit-status` for an in-progress run.
5. Last resort: `act` locally or `mxschmitt/action-tmate` (guard with `if: ${{ failure() }}`,
   `limit-access-to-actor: true`, and remove it once solved). Neither diagnoses a syntax error
   or a run that never reaches a runner; that is `actionlint`'s job.
