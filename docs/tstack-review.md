# Review: t3dotgg/tstack

Refs #1054. Source: <https://github.com/t3dotgg/tstack> at commit `11e37a74` (MIT). Every
claim about tstack cites a file there. Claims about us cite `plugins/github-pr`. Review
only: nothing was installed or copied, and no skill was run.

## What tstack is

Nine agent skills for Claude Code and Codex, plus one Python script, all organised around
one flow: take a change to a merged PR (`README.md`). Install is `cp -R` into
`~/.claude/skills/`. Skills call each other (`full-send` uses `sol-loop`, `file-pr`,
`babysit-pr`; `takeover` uses `modernize`, `file-pr`, `babysit-pr`). Several lean on T3 Code
tools (`delegate_task`, `watch_pull_request`) and fall back to native tools. Personal
settings are meant to live in `CLAUDE.md`, not in the skills.

## What each skill offers, and how it compares to ours

### `babysit-pr` and `pr-wait`: a watcher that wakes the agent per event

- **Offers:** `scripts/pr-wait` is a 25 KB Python script that watches one PR and prints one
  line per real event: a required check failed, checks finished, a new comment or review
  from someone else, a gating bot (Greptile, Macroscope) finished on the head, the base
  moved under files in this PR, the PR went BEHIND or DIRTY, merged or closed. Exit 0 =
  condition met, 1 = needs action, 2 = bad input. A per-PR lock stops two watchers; a state
  file lets a restart report only what arrived meanwhile. CodeRabbit is advisory and never
  waited for. In Claude Code it runs under the Monitor tool.
- **Ours:** `pr-babysit` is one pass per invocation, and monitoring means running it under
  `/loop` (`plugins/github-pr/skills/pr-babysit/SKILL.md`). It has a richer action model
  (`wait-ci`, `update-branch`, `resolve-conflicts`, `fix-ci`, `address-reviews`,
  `ready-to-merge`, `escalate`) and a stricter merge rule (workflow-editing PRs never
  auto-merge).
- **Improvement:** push-based waiting instead of re-polling: fewer turns, and no agent
  polling loop in context. The "base moved under this PR's files" event and the gating
  versus advisory bot split are checks we lack. Cost: Python, which conflicts with our
  TypeScript-scripting decision, and a long-lived watcher needs our background-task bounds.
  Borrow the design, not the code.
- **Also in `babysit-pr`:** a REST fallback when the GraphQL rate limit is used up
  (`gh api repos/<o>/<r>/pulls/<n>`, `.../commits/<sha>/check-runs`). A case-insensitive grep
  of `plugins/github-pr` finds no rate-limit handling, so this is a real gap. Also a scope
  rule for review loops: decline cheap fixes outside the intent, list them as follow-ups,
  prefer the fix that deletes code.

### `file-pr`: PR titles and bodies that lead with the problem

- **Offers:** a BAD/GOOD pair for titles and bodies. Open the description with the problem
  in plain words, then the solution, never an inventory of changed functions. End with the
  model and harness that made the change. Scan title, body and attachments for secrets.
  Opens a real PR, not a draft, so review bots run.
- **Ours:** `github-pr-workflow` covers sizing, sequencing, squash merge and the AI marker,
  but gives no guidance on how a body should read.
- **Improvement:** two or three lines of body-style guidance would lift every PR. Skip the
  "not a draft" rule; we open drafts on purpose.

### `leaving-pr-comments`: attribution format

- **Offers:** every agent comment starts with a `> [!NOTE]` callout, `🤖 **<model> responding
  on behalf of <user>**`, then the reply outside it. No rule, heading or footer. Direct
  style: conclusion first, cite code or a check, separate fact from judgment. Preview, post,
  then verify the URL came back; resolve a thread only after the reply posted.
- **Ours:** `🤖 **Claude:**` prefix on every reply (`pr-comments`), and the same marker on
  anything posted to a PR (`github-pr-workflow`).
- **Improvement:** small. Theirs names the model and the human, and renders as a callout;
  ours is shorter. The "verify the URL, then resolve" order is worth checking against
  `pr-comments`. Optional tweak, not a project.

### `modernize`: decide whether an old PR should still exist, then rebase

- **Offers:** state the PR's intent first, then fetch base and head and look at what landed
  on base since: same problem already solved, APIs or schemas changed, two owners of one
  behaviour, code deleted on purpose. Then pick a disposition before touching anything:
  MODERNIZE (rebase), REWORK (explain the rewrite, stop), or CLOSE (cite evidence, stop,
  never close unasked). Rebase compares `git range-diff` before and after and pushes with
  `--force-with-lease` against the head observed before the rebase.
- **Ours:** nothing equivalent. `worktree-core:git-worktree-usage` covers catching a branch
  up by merge, and `github-pr-workflow` covers a branch whose PR already merged.
- **Improvement:** the clearest gain here. It stops us rebasing PRs that are obsolete, and
  it adds a conceptual-conflict check that a clean rebase never gives. Fits as a new skill
  in `github-pr`.

### `takeover`: finish someone else's PR, branch or thread, keep their credit

- **Offers:** treat the handoff as context, not proof. Import the original commits onto a
  new branch and add your fixes separately, keep Git authorship and co-author trailers,
  credit contributors in the PR body, and keep human credit through a squash. Uses
  `modernize`, `file-pr`, `babysit-pr`.
- **Ours:** `pr-followups` and `pr-session-sweep` handle deferred work and sibling sessions,
  not inherited work.
- **Improvement:** a gap worth a short skill or a section in `modernize`'s successor,
  especially the squash-credit rule.

### `sol-loop` and `council`: review by other providers' models

- **Offers:** `sol-loop` loops one GPT-class reviewer: 3 rounds default, 5 only for
  security, auth, data loss or concurrency, stop early on nits-only, a ledger of findings
  with stable ids, a fixed review brief with blocker/should/nit severities, and a
  "do not agree just to end the loop" rule. `council` runs three providers at once and
  puts a score table in the PR body.
- **Ours:** `adversarial-reviewer` (one hostile Claude reviewer), `fan-out`,
  `subagent-orchestration`. No cross-provider route.
- **Improvement:** the model access is the point of these skills and we do not have it, so
  as written they do not run here. The round budget, ledger and severity brief are reusable
  with our own reviewer and cost nothing to add.

### `full-send` and `full-stop`: change to merged PR in one go

- **Offers:** `full-send`: finish, prove, review, file, babysit, merge, report, with nobody
  watching. Proof means evidence observed this session. A merge gate (proof covers the
  diff, required checks green, bots finished, no change requests, up to date and mergeable)
  and a short list of when to ask. `full-stop` is the same but never merges and removes
  auto-merge first, handing off at the gate.
- **Ours:** the pieces exist (`pr-babysit`, `pr-checks`, `pr-comments`, `pr-followups`) but
  no skill composes them, and nothing states a combined merge gate.
- **Improvement:** `full-stop` would add one trigger and a written merge gate and fits our
  rules. `full-send` does not: it grants itself merge, force-push and "test methods without
  asking" on a phrase, and says that overrides project ask-first rules ("Testing
  permission", `skills/full-send/SKILL.md`). That conflicts with `gh-publish-guide` and with
  the human-merge rule for workflow PRs in `github-pr-workflow`.

## Guardrail checks

- **Permission override:** only `full-send` (above).
- **Outbound content:** `sol-loop` and `council` send the diff to other providers. Fine for
  this public repo; for private repos it needs per-run consent.
- **Fetch-and-execute:** `pr-wait` would run unreviewed on every PR event. Adopting it
  as-is is a fetch-execute install under our rule.
- **Drift:** copies in `~/.claude/skills/` sit outside our plugin structure, hooks and
  evals, so nothing flags when they drift.
- **Licence:** MIT. Verbatim copies keep the notice; re-expressed ideas need none, cite the
  source in the commit.

## Summary of gains

| Rank | Idea | Source | Where it would go |
|---|---|---|---|
| 1 | Disposition before rebase (MODERNIZE/REWORK/CLOSE) | `modernize` | new skill in `github-pr` |
| 2 | REST fallback when GraphQL is exhausted | `babysit-pr`, `file-pr` | lines in `pr-babysit` |
| 3 | Event-driven watcher, base-moved and gating-bot checks | `pr-wait` | design issue, TypeScript |
| 4 | Problem-first PR body and title examples | `file-pr` | `github-pr-workflow` |
| 5 | Credit-preserving takeover | `takeover` | short skill |
| 6 | Review budget, ledger, scope-creep rule | `sol-loop`, `babysit-pr` | `adversarial-reviewer` / `pr-babysit` |
| 7 | One combined merge gate that stops before merge | `full-stop` | owner call |

Not worth building: `full-send`, `leaving-pr-comments`, and the cross-provider skills until
a multi-provider route exists.

## Limits

Read from the repo text only. Gain estimates are judgment. Our "no equivalent" statements
come from greps and a read of `plugins/github-pr` skill headers, not a full read of every
script.
