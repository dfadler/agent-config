---
name: gh-publish-permission
description: |
  Defines what counts as valid, explicit, request-scoped permission before
  creating or posting any publicly visible GitHub content: issues, PRs,
  PR/issue comments or replies, PR reviews, or any `gh api` call that POSTs
  to a comments/reviews endpoint. Use this before running `gh issue create`,
  `gh pr create`, `gh issue comment`, `gh pr comment`, `gh pr review`, or an
  equivalent `gh api` publish call, and whenever a skill (e.g. `pr-babysit`,
  `gh-attach-image`) is about to post on the user's behalf. The user should
  never discover AI-generated public content they did not explicitly approve
  in the request that produced it.
license: MIT
metadata:
  version: "1.0.0"
---

# Explicit permission for publishing to GitHub

## The problem this solves

It's easy for "handle this bug" or "can you look into X" to quietly expand
into "...and also open an issue about it" or "...and reply to that review
comment" — the model treats a broad, adjacent ask as authorization for a
narrower publish action it was never actually asked to take. The user should
never encounter an issue, PR, comment, reply, or review that Claude created
without having explicitly said so, in the request that produced it.

This repo also has a config-level backstop: `.claude/settings.json` puts
`gh issue create`, `gh pr create`, `gh issue comment`, `gh pr comment`,
`gh pr review`, and `gh api` under `permissions.ask`, so the environment
itself will prompt for confirmation before running them — no blanket `gh *`
allow rule can bypass that prompt. This skill is what decides, before that
prompt is even reached, whether the action should be attempted at all, and
gives the model (and the user, when the prompt appears) a shared standard
for what "yes" actually means.

## What counts as a publish action

- Creating an issue or PR (`gh issue create`, `gh pr create`, or the
  equivalent REST/GraphQL call).
- Commenting or replying on an issue or PR (`gh issue comment`,
  `gh pr comment`, `gh api .../comments`).
- Submitting a PR review (`gh pr review`, `gh api .../reviews`).
- Editing the body of an existing issue or PR so its rendered content
  changes (`gh issue edit --body`, `gh pr edit --body`).

## What counts as valid permission

All three of the following must hold. If any is missing, stop and ask —
don't proceed and don't infer consent from something adjacent.

- **Explicit** — the user said yes to this action specifically: "yes",
  "go ahead", "open the issue", "post that reply" — not silence, not moving
  on to the next topic, not a generic "sounds good" about unrelated work.
- **Request-scoped** — the permission was granted in the request that leads
  to this action, not carried over from a different task earlier in the
  conversation, a different PR/issue, or a standing preference recorded
  elsewhere (memory, CLAUDE.md). A user who approved "reply to this one PR
  comment" an hour ago has not pre-approved replying to a different comment
  now.
- **Concise and specific about what's being permitted** — the user (or the
  request itself) named what will be created/posted, e.g. "file an issue
  for this" or "reply to CodeRabbit's comment" — not a vague "handle it" the
  model has to interpret into a publish action.

## What does NOT count

- A broader adjacent task ("fix this bug", "look into X", "clean this up")
  that could plausibly *include* filing an issue or posting a comment, but
  didn't say so.
- A permission granted for a prior, different publish action in the same
  conversation.
- A skill's normal operation implying its own authorization — a skill that
  posts as part of its flow (see below) still needs the *invoking* request
  to have granted that.

## Procedure

1. Before running any publish action (see the list above), check whether
   the current request already contains explicit, request-scoped, specific
   permission as defined above.
2. If it does, proceed — and expect `.claude/settings.json`'s `ask` rule to
   still surface a confirmation prompt; that's the enforcement backstop, not
   a substitute for having asked.
3. If it doesn't, stop and ask the user directly (`AskUserQuestion` or a
   plain question) naming exactly what you're about to create/post and
   where. Don't proceed on an assumption that the broader task implied it.

## Skills that publish as part of their normal flow

`pr-babysit` (replying to review comments) and `gh-attach-image` (uploading
and embedding images into a PR/issue body) post on the user's behalf as
routine steps, not as an incidental side effect. Invoking either skill for
a specific PR/issue *is* the request-scoped permission for the posting that
skill's documented flow performs on that PR/issue — a separate confirmation
for each individual post it makes is not required. This does not extend to
publish actions outside what the skill's own docs describe (e.g. opening a
new issue is not covered by having invoked `pr-babysit`).
