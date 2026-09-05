---
name: pr-checks
description: |
  Review and respond to a single PR's CI checks: snapshot status, diagnose a
  failing run, classify it as branch-related or flaky/infra, and either fix,
  rerun, or escalate. Use when asked "why is CI failing on PR N", "check the
  PR checks", "is CI green on my PR", "rerun the flaky check", "fix the lint
  failure on my PR", or similar — for a specific PR, not a sweep across many.
  Parse `$ARGUMENTS` for a PR number or URL; if a caller already has
  pre-fetched `checks`/`failedRuns` JSON in the shape documented below (e.g.
  a `pr-babysit`-style snapshot), pass that through instead of re-fetching —
  this skill accepts either.
license: MIT
metadata:
  version: "1.0.0"
---

# PR checks: review and respond

Standalone entry point for one PR's CI status — snapshot, diagnose, classify,
act, report. No project-supplied snapshot script or sibling skill is
required: everything here has a plain `gh`-only path. If a caller (e.g.
`pr-babysit`) already has fresher data in the same shape, hand it in and this
skill skips straight to diagnosing instead of re-fetching.

Parse `$ARGUMENTS`: a PR number or URL (required for the `gh`-only path), and
optionally pre-fetched `checks[]` / `failedRuns[]` data in the shape below.

## Step 1 — snapshot the checks

**With only a PR number/URL:**

```bash
gh pr checks <n>
```

For each failing entry, pull its log:

```bash
gh run view <runId> --log-failed
```

Normalize every check to one of `pass` / `pending` / `fail` / `skip`, while
keeping the raw GitHub conclusion (`SUCCESS`, `CANCELLED`, `FAILURE`, etc.)
alongside it. **A `CANCELLED` run is not a real failure** — it's almost
always a run superseded by a newer push (e.g. under a `concurrency` group
with `cancel-in-progress: true`). Both `CANCELLED` and `FAILURE` normalize to
`state: "fail"`, but only a non-cancelled failure is a genuine, fixable CI
failure worth diagnosing below.

**With pre-fetched data:** accept `checks[]` / `failedRuns[]` in the same
shape `pr-babysit`'s snapshot contract emits (see
`plugins/dfadler-agent-config/skills/pr-babysit/SKILL.md`'s "Snapshot
contract" section for the authoritative field list). The fields this skill
reads:

- `checks[]`: `name`, `state` (`pass`/`pending`/`fail`/`skip`), `conclusion`
  (raw), `required`.
- `failedRuns[]`: `runId`, `workflow`, `runAttempt`, `conclusion`, `url`,
  `rerunBudgetLeft`.

Either path produces the same in-memory shape for the steps below — there's
one code path from here on, regardless of how the data arrived.

## Step 2 — diagnose

When `--log-failed`'s summary isn't enough to explain a failure, escalate in
the order documented in `docs/github-actions.md` ("Debugging a failing run")
— quoted here just enough to act without opening the doc:

1. `gh pr checks` / `gh run view <runId> --log-failed` — already done in
   Step 1; this is the default and usually sufficient.
2. `gh api repos/<owner>/<repo>/actions/runs/<runId>/jobs` — per-step status
   and timing (`started_at`/`completed_at`) the summary view collapses.
3. `gh run rerun <runId> --debug --failed` — re-runs the failed jobs with
   verbose step logging, nothing persisted to repo secrets afterward.
4. `gh run watch <runId> --compact --exit-status` — follow an in-progress
   run live instead of polling.
5. **Last resort**, and only for a run that already reaches a runner:
   `act` (local reproduction via Docker, low-fidelity for secrets/service
   containers) or a temporary `mxschmitt/action-tmate` step, guarded with
   `if: ${{ failure() }}`, placed immediately after the failing step, scoped
   with `limit-access-to-actor: true`, and removed once resolved.

For a workflow-*syntax* problem specifically (a run that never reaches a
runner at all), `actionlint` / `make lint-actions` is the required check —
none of the escalation steps above can diagnose a syntax error, since the
run never gets far enough for them to help.

Full detail, rationale, and this repo's actual incident history live in
`docs/github-actions.md` — read it rather than re-deriving the order from
memory if anything here is ambiguous.

## Step 3 — classify and act

For each real (non-cancelled) failure:

- **Branch-related** — the failure traces to this PR's own changes
  (compile/lint/type/test/snapshot failures in touched areas): fix locally
  (see "Fixing locally" below), verify with the failing check's local
  equivalent (not the whole suite for a small fix), commit
  (`fix: <what>`), push.
- **Flaky/infra** — timeouts, runner provisioning, registry/network
  outages, CI infra issues: if `rerunBudgetLeft`, `gh run rerun <runId>
  --failed`; otherwise report the blocker. **Never** "fix" a flake by
  editing tests, CI config, or dependency pins — that masks a real signal
  instead of resolving it.

## Known patterns

Check `docs/github-actions.md`'s "Known failure patterns" section before
treating a failure as novel. Two documented there already:

- **Coverage-gate-fails-on-a-newly-visible-file** (`dfadler/agent-config#106`)
  — a trace-based coverage gate (kcov, etc.) can fail a PR that only *adds*
  tests, never removes any, the first time it measures a file the coverage
  run had never executed before. The fix is to finish covering the
  newly-visible file, not to lower the threshold.
- **Post-merge stricter-rule stragglers** — after merging a PR that adds or
  tightens an enforcing CI rule, a branch cut before that PR merged can carry
  violations its own (pre-rule) CI never saw, going red on the default
  branch despite every individual PR having been green. Watch the
  merge-timing race too (verify against the PR's own state, not the branch
  name).

If you hit a new recurring pattern, add it to `docs/github-actions.md`
rather than re-deriving it ad hoc on a future pass — that doc is the single
source of truth for this repo's failure history, and this skill intentionally
doesn't duplicate it.

## Hard limits

- At most 2 reruns per failing workflow run per SHA (`rerunBudgetLeft`
  encodes this via the run's own attempt count) — then escalate instead of
  rerunning again.
- Never bypass branch protection.
- Only run local verification, fixes, or build/test commands for a PR
  authored by the person driving this pass. For a bot or fork PR, report and
  escalate — never check out and run a third party's branch locally.

## Fixing locally

Never commit against a checkout another concurrent session might also be
using:

- Confirm the checkout's current commit matches the PR's `headSha` before
  editing; if it doesn't (or a pull fails), stop and escalate rather than
  editing against stale state.
- Branch names are data — put the head branch name in a variable and quote
  every expansion (`"$BRANCH"`), never splice it bare into a command.
- Verify proportionately before pushing: run the failing check's local
  equivalent, not the full suite, for a small fix.

## Report

End with one line per check: the check name, the action taken (fixed and
pushed / rerun triggered / reported as blocked / escalated), and whether a
rerun or push is now in flight. For example:

```
lint: FAILURE (branch-related) — fixed locally, pushed as fix: quote unquoted expansion in build.sh
integration-tests: FAILURE (flaky, rerunBudgetLeft) — reran via `gh run rerun 123456 --failed`
coverage: CANCELLED — superseded by newer push, not a real failure, no action
```

Close with a one-line "in flight" summary (e.g. "rerun in progress" / "push
just landed, CI retriggering" / "nothing in flight, all quiet") — phrased so
a caller folding this into a larger pacing report (e.g. `pr-babysit`'s
`PACING:` line) can lift it directly rather than re-deriving it.

## Works standalone

No project-supplied snapshot script, no sibling skill, and no prior pass are
required — a bare PR number or URL via `$ARGUMENTS` is enough to run
snapshot through report end to end using only `gh`. Pre-fetched
`checks`/`failedRuns` data is an optional accelerant, not a dependency.
