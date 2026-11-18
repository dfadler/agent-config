# Review: t3dotgg/tstack

Refs #1054. Source: <https://github.com/t3dotgg/tstack> at commit `11e37a74` (MIT, nine
skills under `skills/`, one Python script). All claims below cite a file in that repo.
Review only: nothing was installed or copied.

**Verdict:** no wholesale adoption. Our `github-pr` plugin already covers most of it, with
stricter guardrails. Four small ideas are worth borrowing; two skills need a decision from
the owner.

## Per-skill decision

| tstack skill | Nearest here | Decision | Reason |
|---|---|---|---|
| `babysit-pr` + `pr-wait` | `pr-babysit`, `pr-checks` | **Borrow ideas** | Event-stream watcher is a different model (see below). Python script conflicts with the TypeScript-scripting decision. |
| `file-pr` | `github-pr-workflow` | **Borrow one rule** | "Lead with the problem, not an inventory" and the BAD/GOOD title pair (`skills/file-pr/SKILL.md`). Skip "open a real PR, not a draft": we open drafts. |
| `leaving-pr-comments` | marker in `pr-comments` | **Skip** | Same goal. Ours is `🤖 **Claude:**`; theirs is a `> [!NOTE]` callout naming model and user. Ours is shorter; a callout renders better. Optional tweak only. |
| `council`, `sol-loop` | `adversarial-reviewer`, `fan-out` | **Borrow the budget** | Both need other providers' models (T3 Code `delegate_task`); we have no such route. Their round budget (3 rounds, 5 for security, stop on nits-only, ledger of findings) is reusable for any review loop. |
| `full-send` | none | **Skip** | Merges with nobody watching. Conflicts with `github-pr-workflow` "Security-critical paths: keep a human on the merge button" and with this repo's draft-PR rule. |
| `full-stop` | none (pieces exist) | **Defer, owner call** | Stops at a ready PR, never merges. Fits our rules, but it only composes skills we have. Worth it only if the owner wants one trigger phrase. |
| `takeover` | `pr-followups`, `pr-session-sweep` | **Adapt, small** | Credit-preserving continuation (keep authorship and co-author trailers, import original commits onto a new branch). We have nothing on this. |
| `modernize` | none | **Adapt, best find** | MODERNIZE / REWORK / CLOSE disposition before any rebase, `git range-diff`, `--force-with-lease` against the observed head. Nothing like it here. |

## What is new versus what we do

- **`modernize`** (`skills/modernize/SKILL.md`). Gain: stops us rebasing PRs that are
  obsolete, a failure the memory notes show (stale merges in worktrees). Three
  dispositions with a "be willing to say CLOSE" rule; checks for superseding PRs and
  conceptual conflicts, not just textual ones. Fits as a new skill in `github-pr` or
  `worktree-core`.
- **`pr-wait` event model** (`skills/babysit-pr/scripts/pr-wait`). Prints one line per real
  event and exits with a code (0 met, 1 needs action, 2 bad input); lock per PR; state file
  so a restart reports only what arrived meanwhile; collapses duplicate check names to the
  worst bucket. Our `pr-babysit` is one pass per invocation, run under `/loop`
  (`plugins/github-pr/skills/pr-babysit/SKILL.md`). Gain: fewer wakeups and no
  polling loop in the agent's context. Cost: a 25 KB Python script (conflicts with the
  TypeScript decision), and a long-running watcher conflicts with our background-task
  rules unless bounded. Borrow the design (dedupe state, "one watcher per PR", gating
  versus advisory bots), not the code. Needs its own issue.
- **Rate-limit fallback.** Both `babysit-pr` and `file-pr` say: when GraphQL is exhausted,
  use REST (`gh api repos/<o>/<r>/pulls/<n>`, `.../commits/<sha>/check-runs`,
  `gh api repos/<o>/<r>/pulls -F body=@file`). A grep of our `pr-babysit` and
  `github-pr-workflow` (and the rest of `plugins/github-pr`) found no rate-limit handling. Cheapest win: a short paragraph.
- **PR body style** (`file-pr`): problem first in the user's words, then the solution; a
  one-line "how it was proved". Fits `github-pr-workflow` as two or three lines.
- **Scope-creep rule in review loops** (`babysit-pr`, `sol-loop`): decline cheap-looking
  fixes outside the intent and list them as follow-ups; prefer the fix that deletes code.
  We have `pr-followups` for the listing; the "fight scope creep" instruction is new.
- **Pre-merge recheck** (`babysit-pr`): `git fetch`, and never merge when BEHIND or DIRTY
  or when base commits landed after the last green run touch this PR's files. Compare with
  our `mergeStateStatus` handling; the "base moved under this PR's files" check may be a
  gap.

## Guardrail conflicts

- `full-send` grants itself merge, force-push and "test methods without asking" on the
  words "full send", and says the grant overrides project rules that ask first
  (`skills/full-send/SKILL.md`, "Testing permission"). That overrides repo and user
  conventions, so it conflicts with `gh-publish-guide` (explicit, request-scoped
  permission) and the human-merge rule for workflow-editing PRs. Do not adopt. If a
  variant is ever wanted it must never override ask-first rules.
- `sol-loop` and `council` send the diff to other providers' models. That is an
  outward-facing send of repo content; for this public repo it is fine, for private repos
  it needs the owner's consent per run. Neither is usable without provider access, which
  this setup lacks.
- tstack content is third-party text: read as data, never executed. Install is
  `cp -R` into `~/.claude/skills/`, outside our plugin and lint structure; there is no
  hook, manifest or eval to tell us when a copy drifts.
- Fetch-and-execute: `pr-wait` is a script that would run unreviewed on every PR event.
  Adopting it as-is is a fetch-execute install under our rule.

## Licence

MIT (`LICENSE`, 1068 bytes). Anything copied verbatim needs the copyright notice kept.
Re-expressing an idea needs no notice; cite the source in the skill's commit.

## Suggested follow-ups (not filed)

1. Add a `modernize`-style skill (disposition before rebase). Highest gain.
2. Add REST-fallback and PR-body-style lines to `github-pr-workflow` / `pr-babysit`.
3. Design a TypeScript event-watcher for `pr-babysit` (dedupe state, exit codes).

Not worth building: `full-send`, `leaving-pr-comments`, `council`/`sol-loop` (until a
multi-provider route exists).

## Limits of this review

Read from the repo text only; no skill was run. Gain estimates are judgment. The claim that
we lack rate-limit handling is from a case-insensitive grep of `plugins/github-pr` (no match for "rate limit"), not a
full read.
