---
name: pr-session-sweep
description: |
  Ask every sub-session this session started to bring its own PR to green:
  fix failed checks, resolve merge conflicts, answer PR review comments, and
  report any follow-up issues worth filing. Use when the user says "ask all
  the sub sessions to fix their checks", "sweep my sessions", "get every
  session's PR unblocked", "tell the sessions to handle conflicts and
  comments", or wants one message fanned out to the linked sessions about
  PR health. Sends one message per linked session, then collects the replies
  into a single table. Not for one PR you are working on yourself
  (`pr-babysit`, `pr-checks`, `pr-comments`).
license: MIT
metadata:
  version: "1.0.0"
---

# Sweep sub-sessions' PRs

## Contract

- **Input:** none required; optional text from `$ARGUMENTS` narrows which sessions
  (a name, or "only those with an open PR").
- **Output:** the same four-task message sent to each linked sub-session, then one
  table of per-session results and the proposed follow-up issues.
- **Does not:** do the PR work itself, file issues, merge, or message sessions this
  session did not start.

## Steps

1. **Find the sub-sessions.** Call `mcp__ccd_session_mgmt__list_sessions` with
   `{"linked": true}` and keep rows whose `startedBy` is this session. The listing is
   the source of truth; do not rely on memory of which sessions exist. Skip archived
   sessions. If `$ARGUMENTS` names a session, keep only those that match it, so a
   request to sweep one session never starts work in the others. If none remain
   (or the name matches nothing), say so and stop.
2. **Send one message to each**, by its `local_…` id with `SendMessage`
   (`notify_when_idle: true`, so you hear when it finishes without polling). Use
   this text, adding only a closing line if `$ARGUMENTS` asked for one:

   > Please do the following for your PR, then reply with a short report.
   > 1. Review and fix all failed checks (load `pr-checks`; rerun only real flakes).
   > 2. Fix all merge conflicts by merging the base branch in, not rebasing a pushed branch.
   > 3. Review and respond to all PR comments (load `pr-comments`; fix or answer each thread).
   > 4. List any follow-up work that needs its own issue (`pr-followups` Detect and Dedupe steps only). Do not file anything.
   > If you have no open PR, or it is already merged, reply "no PR" and stop.
   > Reply format: PR link; checks (fixed/flaky/none); conflicts (resolved/none); comments (n answered, n left for the user); proposed follow-ups.

   Each session works under its own permissions. Do not ask a session to do
   something your own session was denied; route that to the user instead.
3. **Collect.** An idle notice only says the session stopped; it need not carry the
   PR link, results or follow-ups. Mark a session "pending" until it sends a reply in
   the requested format, and "incomplete" if it goes idle without one. A reply is that
   session's report, not proof: spot-check one claim per session with
   `gh pr checks <PR URL>` or `gh pr view <PR URL> --json mergeable` (use the
   reported URL, or add `-R owner/repo`; a bare number targets this session's repo,
   and a sub-session may be working in another) before repeating it as done.
4. **Report** one table (session, PR, checks, conflicts, comments, status), then the
   proposed follow-ups, deduped across sessions. Ask before filing any issue; on a
   yes, file with `pr-followups` and the `issue-tracker` skill.
