---
name: fetch-execute-permission
description: |
  Defines when Claude must stop and ask before running a command that
  fetches code from a registry or URL and executes it in the same step —
  `npx <pkg>@latest ...`, `pnpm dlx`/`bunx`/`uvx` one-off runs, `curl <url> |
  sh`, `go run <url>`, or any similar ad hoc install-and-run for a tool that
  isn't already a declared dependency of the current project. Use this
  before running such a command on the user's behalf, including when a
  setup script or another skill's own docs name one as an optional
  companion install (e.g. the `skills` CLI referenced by this repo's
  README). Does not cover an ordinary `npm install`/`pip install`/`cargo
  add` against a project's own manifest and lockfile — that's a normal,
  already-reviewed dependency change, not an ad hoc fetch-and-execute.
license: MIT
metadata:
  version: "1.0.0"
---

# Explicit permission before fetch-and-execute installs

## The problem this solves

A one-off command like `npx skills@latest add ...` or `curl https://example.com/install.sh | sh`
downloads code from the network and runs it immediately, often with no
lockfile, no pinned version, and no prior review — a materially different
risk than installing a dependency a project has already declared and
audited. It's easy for a broad ask like "install the optional companion" or
"set up the recommended extra" to quietly authorize this too, the same way
`gh-publish-permission` describes a broad ask quietly expanding into a
publish action. The user should always know, in advance, exactly what
command is about to fetch and run third-party code on their machine.

## What counts as a fetch-and-execute install

- `npx <pkg>@latest ...` (or any `npx <pkg>` without a lockfile pinning that
  exact package as a project dependency).
- `pnpm dlx`, `bunx`, `uvx`, `pipx run`, or any other "fetch, don't persist"
  package runner.
- `curl <url> | sh`, `wget -O- <url> | bash`, or piping a fetched script
  straight into an interpreter.
- `go run <url>`, `deno run <url>`, or executing a URL directly.
- A `skills add`, `npm install -g`, `brew install`, or similar command whose
  entire purpose in the current task is a one-off tool acquisition — not a
  change to the project's own dependency manifest.

## What does NOT count

- `npm install`/`npm ci`/`pip install -r requirements.txt`/`cargo add`/`go
  get`/etc. run against the project's own manifest and lockfile — this is a
  normal, already-reviewed dependency change (see the global CLAUDE.md's
  "Dependency changes: audit before done").
- Running a tool that's already installed and on `PATH` (no fetch is
  happening).
- A command the user typed themselves and asked Claude to run verbatim —
  that request *is* the explicit permission, as long as it names the exact
  command (not "run whatever installs X").

## What counts as valid permission

Same bar as `gh-publish-permission`'s: explicit, request-scoped, and
specific about the exact command.

- **Explicit** — the user said yes to *this* command, not a generic "sounds
  good" about the broader task.
- **Request-scoped** — permission from installing a different tool earlier
  in the conversation doesn't carry over to this one.
- **Specific about the exact command** — show the full command (including
  the package/URL) before asking, not a vague "I'll install the CLI." A user
  can't meaningfully consent to a command they haven't seen.

There is no standing-exception file for this skill (contrast
`gh-publish-permission`'s `~/.claude/gh-publish-exceptions.json`) — the
policy is to ask every time, not once-per-package, and Claude never creates
or proposes a standing exception on its own initiative.

**Precedence when `.claude/settings.json` already has a matching rule:** an
*exact-string* Bash allow rule the user deliberately added themselves —
this repo's own Aikido Safe Chain installer rule (see the README) is the
existing example: one specific pinned-version, checksum-verified command,
approved through an explicit interactive y/n step — is valid standing
permission for that one command; it doesn't need to be re-asked every run,
since asking is exactly what the user already did once, visibly, when they
approved the rule. A *broad or wildcard* allow rule (`Bash(npx:*)` or
similar) never counts as consent for a specific fetch-and-execute command it
wasn't written with awareness of — treat it the same as no rule at all and
ask.

## Procedure

1. Before running any command matching "What counts" above, check whether
   the user has already explicitly confirmed the exact command shown in
   this conversation, or pasted/dictated the exact command themselves —
   either satisfies "explicit, request-scoped, specific."
2. If it does, proceed.
3. If it doesn't, stop and show the exact command, name what it fetches and
   what it will execute, and ask before running it. Don't proceed on an
   assumption that a broader "install the optional thing" already covered
   it. A user's "yes"/"go ahead" reply to that specific shown command now
   satisfies step 1 — go back and proceed.
4. If the user declines or doesn't respond, hand them the command to run in
   their own terminal instead of substituting a workaround (a vendored
   copy, a different install path) without asking first.
