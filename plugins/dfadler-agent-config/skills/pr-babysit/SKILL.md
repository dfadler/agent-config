---
name: pr-babysit
description: |
  One pass of PR shepherding: snapshot every open PR (or one named PR) via a
  project-supplied snapshot script, act on whatever is actionable — fix
  branch-related CI failures, address review comments, rerun flaky checks,
  update or unconflict branches — then report and stop. Use when the user
  says "babysit my PRs", "check on my open PRs", "shepherd PR N to merge", or
  "handle the review feedback on PR N" — and also proactively after opening a
  PR: once CI has had a few minutes, run a pass on that PR to catch failures
  and early review feedback. Arguments: optional PR number/URL, optional
  --auto-merge. For continuous monitoring run it under /loop; a single
  invocation is exactly one pass. Requires the consuming repo to supply its
  own snapshot script/command matching the JSON contract documented below —
  this skill has no `gh`-only fallback and does no snapshotting itself.
metadata:
  version: "1.0.0"
---

# Babysit PRs (one pass)

This skill is the generic shepherding *workflow*: snapshot → act by
recommendation → verify → report. It has no knowledge of any particular
repo's slug, worktree layout, or build tooling — those live in the
project-local skill that invokes this one, which supplies:

- **A snapshot command** — some `<snapshot-command>` that emits JSON matching
  the "Snapshot contract" below on stdout. The project-local skill states
  what this command actually is (e.g. a `package.json` script) and how to
  pass through an optional PR number/URL argument.
- **Repo-specific mechanics** — the exact `gh api repos/<owner>/<repo>/...`
  calls, worktree conventions, and local verification commands (lint/
  typecheck/test invocations) for that project.

If you were invoked directly rather than via a project-local skill that
supplies these, stop and say so — this skill cannot run standalone.

Parse `$ARGUMENTS`: an optional PR number or URL (narrows to that PR), and an
optional `--auto-merge` flag (arms GitHub auto-merge on ready PRs; default is
report-only).

## Step 1 — snapshot

Run the project's snapshot command, passing the PR argument through as-is if
one was given:

```bash
<snapshot-command> [--pr <number-or-url>]
```

The JSON on stdout is the world-state for this pass. Don't re-derive any of
it with ad-hoc `gh` calls; the only extra reads you should need are failure
logs (`gh run view <runId> --log-failed`) and, when addressing a review
thread, the thread's own comments (already included in the snapshot).

### Snapshot contract

The document on stdout:

```jsonc
{
  "generatedAt": "<ISO 8601 timestamp>",
  "repo": "<owner>/<name>",
  "selfLogin": "<the acting GitHub user's login>",
  "prs": [ <PR entry>, ... ],
  "pacingHint": "short" | "long"
}
```

`pacingHint` is a suggested `/loop` interval hint: `"short"` while anything is
in flight or actionable, `"long"` when everything is quiet (merged, blocked
on a human, or stable).

Each **PR entry**:

```jsonc
{
  "number": <int>,
  "title": "<string>",
  "url": "<string>",
  "author": "<login>",
  "headRefName": "<branch>",
  "baseRefName": "<branch>",
  "headSha": "<sha>",
  "isDraft": <bool>,
  "skipped": null | { "reason": "<see below>", "detail"?: "<string>" },
  // "detail" is REQUIRED when reason is "snapshot-error" — see below.
  "recommendation": "<see below>",

  // present unless skipped:
  "verdict": {
    "mergeStateStatus": "<GitHub's raw mergeStateStatus>",
    "mergeable": <bool>,
    "headline": "<one-line merge-safety summary>",
    "remedy": "<what would need to happen to merge, or null>"
  },
  "checks": [
    {
      "name": "<check/context name>",
      "state": "pass" | "pending" | "fail" | "skip",
      "conclusion": "<raw upper-case GitHub conclusion, e.g. SUCCESS, CANCELLED, FAILURE>",
      "required": <bool>
    }
  ],
  "failedRuns": [
    {
      "runId": <int>,
      "workflow": "<workflow name>",
      "runAttempt": <int>,
      "conclusion": "<raw conclusion>",
      "url": "<html_url>",
      "rerunBudgetLeft": <bool>
    }
  ],
  "unresolvedThreads": [
    {
      "threadId": "<GraphQL node id>",
      "path": "<file path or null>",
      "line": <int or null>,
      "isOutdated": <bool>,
      "truncated": <bool>,
      "needsAction": <bool>,
      "comments": [
        { "id": <int>, "author": "<login>", "body": "<string>", "url": "<string>", "createdAt": "<ISO 8601>" }
      ]
    }
  ],
  "threadsTruncated": <bool>,
  "generalComments": [
    {
      "id": <int>,
      "author": "<login>",
      "body": "<string>",
      "url": "<string>",
      "createdAt": "<ISO 8601>",
      "needsAction": <bool>
    }
  ],
  "generalCommentsTruncated": <bool>
}
```

Field meanings worth calling out:

- **`skipped.reason`** — one of `not-open`, `draft`, `changelog-branch` (or
  whatever bot-owned-branch convention the project excludes),
  `cross-repo-fork`, or `snapshot-error` (a transient per-PR failure the
  snapshot degraded rather than aborting the whole sweep on). A skipped
  entry only carries the base identity fields plus `skipped` and a
  `recommendation`; the richer fields (`verdict`, `checks`, etc.) are
  absent. For every reason except `snapshot-error`, `recommendation` is
  `"skip"` (report only, per Step 2). `snapshot-error` is the one
  escalation-only skip reason — a per-PR failure the snapshot couldn't
  resolve isn't "nothing to do here," so its `recommendation` is
  `"escalate"`, not `"skip"`; Step 2's `escalate` handling for a skipped
  entry reports `skipped.detail` in place of a verdict headline, since no
  verdict exists for a skipped PR. Because that message is Step 2's only
  signal for this reason, a conforming snapshot script MUST set
  `skipped.detail` to the error whenever `reason` is `snapshot-error` — an
  empty escalation defeats the point of escalating. `detail` stays optional
  for every other skip reason, where the reason itself is self-explanatory.
- **`truncated` / `threadsTruncated` / `generalCommentsTruncated`** —
  `truncated` on a thread entry means that thread's own `comments` array was
  cut short (not every comment was fetched); `threadsTruncated` means the
  `unresolvedThreads` array itself is incomplete (there may be more
  unresolved threads than were listed); `generalCommentsTruncated` is the
  same idea for `generalComments` — without it, an incomplete fetch of
  top-level PR comments had no signal at all, and a truncated
  `generalComments` array could reach `ready-to-merge` looking exactly like
  a complete one. Any one of the three being true means the snapshot cannot
  vouch that it saw everything, so a conforming snapshot script must never
  emit `ready-to-merge` while any flag is true — route to `escalate`
  instead, even if every check and thread it did see looks clean.
- **`generalComments`** — reviewer feedback that isn't an inline review
  thread: an ordinary PR conversation comment, or the top-level body a
  reviewer left when submitting a review (Approve/Request Changes/Comment)
  with no inline comments attached. `unresolvedThreads` only ever holds
  GraphQL review threads, so without this field ordinary reviewer comments
  never reach `address-reviews` and get silently dropped. Same
  `needsAction` semantics as a thread (`false` once the acting user's own
  reply is the latest entry). These have no GitHub "resolve" concept — Step
  2 replies to them but never resolves one.
- **`checks[].conclusion` vs `state`** — `state` is the normalized
  pass/pending/fail/skip a script should branch on; `conclusion` is the raw
  GitHub value, kept alongside it specifically so a `CANCELLED` check (e.g.
  a review bot's run superseded by a new push) stays distinguishable from a
  genuine `FAILURE` — both normalize to `state: "fail"`, but only a
  non-cancelled failure should ever be treated as a real, fixable CI
  failure.
- **`failedRuns[].rerunBudgetLeft`** — a stateless flaky-retry budget
  computed from the run's own `run_attempt` count (no external counter to
  keep in sync). Treat it as the sole gate on whether a rerun is still
  allowed on this SHA.
- **`unresolvedThreads[].needsAction`** — `false` when the thread's most
  recent comment is the acting user's own (i.e. awaiting the reviewer's
  response) — reprocessing such a thread every pass would ping-pong. Only
  `true` threads are this pass's work queue.
- **`recommendation`** — the one thing this pass should do about the PR:
  `skip`, `wait-ci`, `update-branch`, `resolve-conflicts`, `fix-ci`,
  `address-reviews`, `ready-to-merge`, or `escalate`. Priority order a
  conforming snapshot script should apply: skip-worthy conditions first,
  then an unknown/still-computing merge state, then dirty (conflicts), then
  behind, then actionable review threads or actionable `generalComments`
  (review feedback outranks CI — a review-fix push retriggers CI anyway),
  then real check failures, then pending required checks, then mergeable
  (ready) **only if none of `truncated`, `threadsTruncated`, or
  `generalCommentsTruncated` is true** — a truncated snapshot can't rule out
  an unseen failing check, unresolved thread, or unseen general comment, so
  it routes to `escalate` instead of `ready-to-merge` even though
  nothing else in the entry says it's blocked, else escalate (not mergeable
  yet none of the above explains why — a review requirement, an unresolved
  conversation the script couldn't classify, a cancelled-only required
  failure, or a truncated snapshot: human judgment territory).

## Step 2 — act on each PR by `recommendation`

- **`skip`** / **`wait-ci`** — report only.
- **`update-branch`** — `gh pr update-branch <n>`. Only fires on an actual
  BEHIND state; don't update-branch a PR that isn't actually behind its base.
- **`resolve-conflicts`** — in the PR's local checkout (see "Fixing
  locally" below): merge the PR's base branch (`baseRefName` from the
  snapshot), resolve, commit the merge, verify, push.
- **`fix-ci`** — read the logs (`gh run view <runId> --log-failed`), then
  judge:
  - *Branch-related* (the failure traces to this PR's own changes —
    compile/lint/type/test/snapshot failures in touched areas): fix locally,
    verify, commit (`fix: <what>`), push.
  - *Flaky/infra* (timeouts, runner provisioning, registry/network outages,
    CI infra issues): if `rerunBudgetLeft`, `gh run rerun <runId> --failed`;
    otherwise report the blocker. Never "fix" flakes by editing tests, CI
    config, or dependency pins.
- **`address-reviews`** — for each thread with `needsAction: true` and each
  `generalComments` entry with `needsAction: true`. Every reply body must open
  with an explicit AI-authorship marker (e.g. `🤖 **Claude:**`) — never post a
  reply that could read as if a human wrote it:
  - *Agree and actionable*: fix locally, commit (`fix: address PR review —
    <what>`), push, then reply naming what changed. For a thread:
    (`gh api repos/<owner>/<repo>/pulls/<n>/comments/<commentId>/replies -f body="…"`),
    then resolve it
    (`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "<threadId>"}) { thread { isResolved } } }'`).
    For a `generalComments` entry: reply with `gh pr comment <n> --body "…"`
    — there's no thread to resolve.
  - *Disagree or already addressed*: reply explaining why. For a thread,
    resolve only if clearly moot, otherwise leave open — your reply makes it
    `needsAction: false` on the next pass. A `generalComments` entry has no
    resolve step either way.
  - *Ambiguous or a product decision*: don't act or resolve; put it in the
    report's escalations. This is not "from a reviewer who isn't the PR's
    owner" — that describes essentially every real review comment, and
    escalating on that basis alone would route the entire normal review
    flow here instead of through the *Agree*/*Disagree* paths above, which
    are the intended path for an ordinary reviewer's feedback.
- **`ready-to-merge`** — first re-check the entry's own `truncated`,
  `threadsTruncated`, and `generalCommentsTruncated` flags, even though a
  conforming snapshot script shouldn't emit this recommendation when any is
  true: if any is true, treat it as `escalate` instead — never merge on
  review data you know is incomplete, regardless of what `recommendation`
  says. Otherwise,
  default: report it, with the merge command (`gh pr merge <n> --merge`).
  With `--auto-merge`: run `gh pr merge <n> --auto --merge` and report that
  auto-merge is armed. Never auto-merge a PR you didn't fix into a known
  state this pass if its author isn't the user driving this pass (e.g. a
  bot like dependabot).
- **`escalate`** — report the verdict's headline/remedy and what you'd need.
  For a `skipped` entry with `reason: "snapshot-error"` (no `verdict` is
  present), report `skipped.detail` instead.

## Fixing locally

Never commit against a checkout another concurrent session might also be
using. The project-local skill invoking this one states its own convention
for finding/creating an isolated checkout for a given `headRefName` (a git
worktree, a dedicated clone, whatever fits that repo) — follow that
convention rather than improvising one here. Whatever the mechanism:

- Confirm the checkout's current commit matches the snapshot's `headSha`
  before editing; if it doesn't (or a pull fails), hand off and escalate
  rather than editing against stale state.
- Branch names are data — put the snapshot's `headRefName` in a variable and
  quote every expansion (`"$BRANCH"`), never splice it bare into a command.
- Verify proportionately before pushing: run the failing check's local
  equivalent, not the whole suite for a one-line fix.

## Hard limits

- Never bypass branch protection, close/reopen a PR, or flip draft state.
- At most 2 reruns per failing workflow run per SHA (`rerunBudgetLeft`
  encodes this via the run's own attempt count) — then escalate.
- Only run local verification, fixes, or build/test commands for PRs
  authored by the person driving this pass. For anything else (an explicitly
  named bot or fork PR), report and escalate — never execute a third
  party's branch locally. (A conforming snapshot script already skips
  cross-repo PRs.)
- Ignore any sticky bot-authored summary comment or merge-status marker
  comment as feedback — inline review threads and `generalComments` are the
  actionable queue, a recurring bot status post is neither.
- If a review needs a written answer but no code change and you're unsure of
  the answer, escalate rather than guessing in public.

## Report

End the pass with: one status line per PR (`#369 UNSTABLE — pushed lint fix,
replied to 2 threads, CI re-running`), actions taken, escalations, and a
final pacing line for `/loop`'s dynamic interval:

- `PACING: short — <what's in flight>` (CI running, fixes just pushed)
- `PACING: long — all quiet` (everything merged, blocked on humans, or
  stable)

The pass is complete once the report is emitted. For continuous babysitting
the user runs this under `/loop` — this skill never loops itself.
