---
name: github-pr-workflow
description: |
  Conventions and guardrails for working with GitHub PRs: permissions, opening
  and sizing PRs, checking CI, responding to review comments, and the
  security-critical merge rule. Load whenever doing PR work in any repo —
  creating, updating, commenting on, or merging a pull request.
license: MIT
metadata:
  version: "1.0.0"
---

# GitHub PR workflow

## Permissions

**Never create or modify a GitHub issue or PR, post a comment, edit a body, or
submit a review without explicit, request-scoped permission** — see
`dfadler-agent-config:gh-publish-permission`; the `.claude/settings.json`
ask-rules backstop it.

**Any comment, reply, or review posted on a GitHub PR or issue must be clearly
identified as AI-generated** — lead the body with an explicit marker (e.g.
`🤖 **Claude:**`) rather than letting it read as if a human wrote it.
`pr-review-rubric`'s `🤖 **Claude:**` / `## 🤖 Claude Auto-Review` markers
already satisfy this for review output; apply the same idea to a plain
`pr-babysit` reply or a one-off `gh pr comment`/`gh issue comment`. This is a
transparency requirement, not a style choice — don't drop the marker to keep a
reply terse.

## Opening and sizing a PR

- Size a PR by whether it would be mergeable and valuable standing alone, not by
  line count. Split when a piece is independently useful on its own; keep pieces
  together when they only make sense as one concern.
- When two or more PRs are in flight and their merge order matters, add a
  `## Sequencing` section to the PR body: name every related PR, state what
  happens under each possible merge order, and say explicitly what gets closed
  or superseded rather than leaving it to be inferred from the diff.
- Merge via ordinary merge commits, not squash — keep review-iteration commits
  as permanent, individually-referenceable history rather than collapsing them.

## After opening a PR

The task isn't done once a PR is open. Once CI has had a few minutes to produce
signal, check its status (`gh pr checks`) and any early review comments
(`gh pr view --comments`), and act on what's actionable before ending the turn.
Some projects have a dedicated skill/script for this shepherding pass; use it if
present, otherwise do the check manually.

When `gh pr checks`/`gh run view --log-failed` doesn't explain a failure,
escalate through the Actions jobs API and a verbose debug rerun before reaching
for local reproduction (`act`) or a guarded, temporary `action-tmate` step as a
last resort — see the `dfadler-agent-config:pr-checks` skill (Step 2) for the
exact order, flags, and safety guards, and `docs/github-actions.md` for the
full rationale and incident history. `make lint-actions`/`actionlint` remain
the required check for a workflow-*syntax* problem — none of the above can
diagnose one, since a syntax error never reaches a runner.

## Responding to review comments

When a change addresses a PR review comment (bot or human), reply to that
specific comment rather than pushing silently — say what changed, or push back
with why not.

- Inline/review comment:
  `gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment-id>/replies -f body="<reply>"`
- General PR-level comment: `gh pr comment <pr> --body "<reply>"`

Treat CI passing, not an approving human review, as the actual merge gate —
don't wait on or expect an approval that isn't part of how this repo works.

Classify and reply to each review finding using the
`dfadler-agent-config:pr-comments` skill's four-outcome rubric
(Fixed/Refuted/Confirmed-but-deferred/Judged-not-real) and its exact reply
templates — including its rules for an automated reviewer re-litigating a
refuted finding and for spinning an out-of-scope finding into a new issue
rather than scope-creeping the current PR.

## `.github/` stays config-only

Limit `.github/` to platform configuration: workflows (`.github/workflows/`),
CODEOWNERS, dependabot/release config, and a **generic** PR/issue template.
Feature- or product-specific docs, playbooks, or checklists belong under the
project's own docs directory, not `.github/`. If a specific feature genuinely
needs its own PR template, use an opt-in file under
`.github/PULL_REQUEST_TEMPLATE/<feature>.md` — never grow the generic template
with feature-specific sections.

## Security-critical paths: keep a human on the merge/approve button

The "CI passing is the merge gate" rule above is this repo's own default; it
does not extend to security-critical or regulated paths. Research shows a
crafted comment or string literal in code under review can instruct a
reviewing agent to overlook a vulnerability or wave it through — an attack
surface that doesn't exist for a human reviewer, with no fully solved defense
yet (arXiv:2606.13175 §VI.C; corroborated by Endor Labs, NVIDIA, and Cloud
Security Alliance write-ups on the same 2026 concern). As a standing guardrail:
**an agent must never autonomously approve or merge a pull request touching a
security-critical or regulated path.** Any "move the workstream forward via
agents" design (this repo's `pr-babysit`/`--auto-merge` included) keeps a
human on that button for these paths — surface the PR and diff and stop, don't
`gh pr merge` or approve it yourself.

"Security-critical," for this purpose, means at minimum: auth/authz code;
credential, secret, or token handling; `.github/workflows/` and other CI/CD
definitions; dependency manifests/lockfiles (supply-chain surface);
`.claude/settings.json` permissions or hooks; and this repo's own PR
review/merge tooling (`pr-review-rubric`, `pr-babysit`, `pr-comments`,
`pr-checks`, `gh-publish-permission`). Treat that as a floor — extend it by
judgment to a given repo's actual regulated surface (PCI/HIPAA/PII-handling
code, for instance).
