---
name: compare
description: >
  Orchestrate a before/after screenshot (or video) comparison across two
  branches — typically a PR's base branch and its compare branch, each
  served by its own already-running dev server. Resolves the two URLs to
  capture (from `.claude/settings.json` config or explicit overrides),
  delegates the actual capture to `screen-capture:capture` once per URL, and
  delegates upload/PR-comment formatting to `screen-capture:attach`. Use
  when asked to compare rendered output between two branches, produce a
  before/after screenshot for a PR, or verify a visual change against main.
license: MIT
metadata:
  version: "0.1.0"
---

# compare

This skill resolves *which two URLs* to capture and *orchestrates* the two
downstream skills that do the actual work. It does not talk to a browser
itself (that's `screen-capture:capture`) and does not talk to GitHub itself
(that's `screen-capture:attach`).

## Precondition: dev servers are the caller's job

This skill **never starts a dev server**. Both the base-branch and
compare-branch URLs must already be reachable before this skill runs — if
neither resolves (see below), stop and tell the caller to start the
relevant server(s) rather than launching one yourself.

A typical worktree-based setup runs one dev server per checkout, each on its
own port: the main checkout serves the base branch (e.g. `main`) and a PR
worktree serves the compare branch. The `dev_server_command` /
`compare_dev_server_command` config keys below exist to document, for
whoever's driving this skill, which command brings up which side — this
skill reads them for that documentation purpose only and never executes
them.

## Resolving the two URLs

Two ways to get a "before" URL and an "after" URL, in this order:

1. **Explicit override.** A `--before <url>` / `--after <url>` pair passed
   to this skill always wins, whole pair at a time — this is also the only
   path when there is no `.claude/settings.json`, or config is ambiguous
   (e.g. only one of `base_url` / `compare_base_url` is set).
2. **Auto-detect from config.** If both `--before` and `--after` are
   omitted, read `screenCapture.base_url` (before) and
   `screenCapture.compare_base_url` (after) from the repo's
   `.claude/settings.json`. Both must be present and non-empty to count as
   resolved; if only one is set, treat config as ambiguous and fall back to
   requiring explicit `--before`/`--after` instead of guessing the other.

If, after both steps, either URL is still unresolved: stop and ask the
caller to either add the missing `screenCapture` key(s) to
`.claude/settings.json` or pass `--before`/`--after` directly. Do not
default to `localhost` with a guessed port.

## Config keys (`.claude/settings.json` → `screenCapture`)

| Key | Read by | Meaning |
| --- | --- | --- |
| `base_url` | this skill | URL to capture for "before" (base branch) |
| `compare_base_url` | this skill | URL to capture for "after" (compare branch) |
| `dev_server_command` | caller (documentation only) | Command that serves the base branch at `base_url` |
| `compare_dev_server_command` | caller (documentation only) | Command that serves the compare branch at `compare_base_url` |

Example:

```json
{
  "screenCapture": {
    "base_url": "http://localhost:5173",
    "compare_base_url": "http://localhost:5174",
    "dev_server_command": "npm run dev",
    "compare_dev_server_command": "npm run dev -- --port 5174"
  }
}
```

Only `base_url`/`compare_base_url` change this skill's behavior; the two
`*_command` keys are read solely to surface in error/status messages so a
human or calling agent knows which command to run when a URL isn't up yet.

## Delegation flow

Once both URLs are resolved:

1. Call `screen-capture:capture` once per URL (before, then after), passing
   through any shared route/viewport/output-type params so both captures
   are directly comparable (same page, same viewport, same output type).
2. Call `screen-capture:attach` with both resulting files to handle
   upload and before/after comment formatting — this skill does not touch
   GitHub or any other target directly.

## What this skill does not do

- Does not start, stop, or health-check dev servers.
- Does not decide *whether* a visual diff is required for a given PR (that's
  project policy, not this skill).
- Does not upload or post anywhere — that's entirely `screen-capture:attach`.
