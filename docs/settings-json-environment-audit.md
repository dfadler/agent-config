# `.claude/settings.json` environment-layer audit

This is the environment-layer companion to
[`docs/prompt-injection-defense.md`](./prompt-injection-defense.md), which
names environmental controls (least privilege, sandboxing, egress
restriction) as the layer that "holds regardless of model intent" once
something has slipped past the model's own judgment. That doc sketches the
layer in general terms and points here for the specifics; this doc is the
concrete accounting: what's actually active in this repo's Claude Code
configuration today, what Claude Code offers that isn't turned on, and what
changed as a result.

Written for issue [#179](https://github.com/dfadler/agent-config/issues/179),
part of the [#176](https://github.com/dfadler/agent-config/issues/176)
umbrella. Scope is investigate-and-document, per the issue — this doesn't
end in a sandboxed execution environment, just an honest accounting and the
narrow, well-justified config changes the accounting turned up.

**A note on sequencing:** at the time of writing, issue #177 (the reference
doc above) is open as PR [#186](https://github.com/dfadler/agent-config/pull/186),
not yet merged. This doc cross-references it by content rather than waiting,
since #186 already links back here for this exact section.

## Current state

### `.claude/settings.json` (checked into git, applies to every contributor)

The entire file, in full, as of this audit (including the one change this PR
makes — see "Gaps and what changed in this PR" below):

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "disableBypassPermissionsMode": "disable",
    "ask": [
      "Bash(gh issue create)",
      "Bash(gh issue create *)",
      "Bash(gh pr create)",
      "Bash(gh pr create *)",
      "Bash(gh issue comment)",
      "Bash(gh issue comment *)",
      "Bash(gh pr comment)",
      "Bash(gh pr comment *)",
      "Bash(gh pr review)",
      "Bash(gh pr review *)",
      "Bash(gh issue edit)",
      "Bash(gh issue edit *)",
      "Bash(gh pr edit)",
      "Bash(gh pr edit *)",
      "Bash(gh api *)"
    ]
  }
}
```

That's the entire environment-layer footprint: one `ask` list, no `allow`,
no `deny`, plus the `disableBypassPermissionsMode` toggle this PR adds (see
below). The `ask` list gates exactly the GitHub publish surface `gh-publish-permission`
(`plugins/dfadler-agent-config/skills/gh-publish-permission/SKILL.md`)
documents — issue/PR creation, comments, reviews, edits, and every `gh api`
call — behind a confirmation prompt that, per Claude Code's own permission
ordering (deny, then ask, then allow; first match wins), no blanket `gh *`
or `Bash` allow rule anywhere else can bypass. That's a real, working
human-layer backstop, and it's the thing `docs/prompt-injection-defense.md`
already points to for layer 4.

What it is *not* is least privilege, sandboxing, or egress control in the
environmental-layer sense. It gates a specific, named set of Bash command
shapes. It says nothing about what an injected instruction could do with
Bash outside that list — read arbitrary files, write anywhere the current
permission mode allows, or reach an arbitrary network host — because none of
that is fenced by an OS-level boundary. Those actions still go through
Claude Code's default per-command approval flow in Manual mode (see below),
but that's the model-adjacent permission system, not the sandbox.

### `.claude/settings.local.json` (this developer's machine only, gitignored, not repo-tracked)

Per Claude Code's own settings precedence, this file lives outside
`.gitignore` exceptions and outside this repo's tracked history — confirmed
via `git check-ignore -v .claude/settings.local.json`, which resolves through
this machine's global gitignore (`~/.config/git/ignore`), not a repo-local
rule. It never appears in a diff and this PR does not modify it; it's
included here only because the issue asked for it to be reviewed, and
because one entry is a concrete finding worth recording.

The file's `permissions.allow` list is a mix of narrow, single-purpose
entries accumulated from "Yes, and don't ask again" approvals — `Bash(cat)`,
a handful of exact `rm -f`/`sed -i` invocations against specific `/tmp`
scratch files from past PR-body editing, `Bash(git ls-remote *)`,
`Bash(gh pr *)` — plus one that stands out:

```text
"Bash(python3 -c ' *)"
```

This is a trailing-wildcard rule that matches **any** `python3 -c '...'`
invocation, regardless of what the script does, with no `ask` or `deny`
counterpart. It's exactly the fragile-pattern shape Claude Code's own
[permissions docs](https://code.claude.com/docs/en/permissions#redirections)
warn about for Bash rules that try to constrain arguments after a fixed
prefix — the docs' own example is `Bash(curl http://github.com/ *)`, which
looks scoped but isn't. Here the same shape was almost certainly saved from
approving one specific one-off Python one-liner, and it has quietly stood
as a standing grant for arbitrary Python code ever since: a compromised or
injected instruction that gets Claude to run `python3 -c '<anything>'` on
this machine executes without a confirmation prompt, including something
that reads a credential file and exfiltrates it over the network from inside
that one-liner.

This finding is local to this developer's machine and this PR doesn't (and
structurally can't, since the file isn't tracked) fix it. Recorded here so
the user can prune it directly — `/permissions` or hand-editing
`.claude/settings.local.json` — the same way they'd review any other
accumulated local allow-rule.

## What Claude Code offers for this layer, and isn't turned on here

Claude Code ships a real OS-level environmental control — the **sandboxed
Bash tool** — that neither this repo's project settings nor this
developer's user settings (`~/.claude/settings.json`, checked separately for
this audit) currently enable. Summarized from the current
[sandboxing docs](https://code.claude.com/docs/en/sandboxing) and
[security docs](https://code.claude.com/docs/en/security) (Claude Code
v2.1.216 was the installed version at the time of this audit):

- **Filesystem isolation.** Sandboxed commands get write access to the
  working directory, added directories, and the session temp dir only;
  writes anywhere else are blocked at the OS level (Seatbelt on macOS,
  bubblewrap on Linux/WSL2) — enforced on the running process regardless of
  what the command string looked like when Claude Code approved it. Read
  access defaults to the whole filesystem (including credential files like
  `~/.ssh` and `~/.aws/credentials` unless explicitly denied via
  `sandbox.filesystem.denyRead` or the dedicated `sandbox.credentials.files`
  block), so filesystem isolation alone doesn't protect credentials — that
  needs an explicit deny/mask entry.
- **Network isolation.** A proxy enforces a per-domain allowlist for
  sandboxed commands; nothing is pre-allowed by default, first use of a new
  domain prompts (or the domain has to be pre-listed in
  `sandbox.network.allowedDomains`). This is the actual egress-restriction
  control the issue asked about — the kind that "holds regardless of model
  intent" because the OS enforces it on the process, not on the command
  string Claude Code parsed.
- **Credential masking.** `sandbox.credentials.envVars`/`.files` can strip or
  substitute-on-egress specific secrets (`GITHUB_TOKEN`, `~/.aws/credentials`,
  etc.) from sandboxed commands specifically, independent of filesystem
  isolation.

None of the sources this audit inspected enable it: there is no `sandbox` key
in the checked-in `.claude/settings.json`, nor in this developer's own user
settings at `~/.claude/settings.json` (checked separately for this audit,
since sandboxing is one of the few areas where user settings matter more
than project settings — several sub-settings, like `filesystem.disabled` and
credential masking, are honored only from user or managed settings). Neither
this repo nor this developer's account currently turns sandboxing on for any
source this audit could see; a contributor's own `--settings` CLI flag or
local `.claude/settings.local.json` could still enable it for themselves,
independent of what's checked in here. Absent that, Bash commands run
unsandboxed by default: filesystem and network access are bounded only by
the permission system's per-command approval flow (Manual mode asks before
non-read-only Bash commands by default) and whatever `allow` rules have
accumulated locally, not by an OS-enforced boundary.

## Gaps and what changed in this PR

1. **No sandboxing enabled anywhere.** Documented above. **Not changed in
   this PR** — see "Deliberately not changed" below for why.
2. **No `permissions.deny` list.** The only rules in the checked-in file are
   `ask` rules for a specific publish surface; nothing is hard-blocked.
   Combined with no sandboxing, there's no environmental backstop if a
   session's permission mode ever shifts to something more permissive than
   Manual (`auto`, `acceptEdits`, or `bypassPermissions`) or if a broad
   `allow` rule accumulates locally (see the `python3 -c` finding above).
   **Not changed in this PR** — see below.
3. **`bypassPermissions` mode was not disabled.** This is the one Claude
   Code mode where the "regardless of model intent" property this whole
   audit is about actually stops holding: `bypassPermissions` skips
   permission prompts entirely, including the `ask` gate that backs
   `gh-publish-permission`. Nothing in this repo's docs or skills documents
   a reliance on running Claude Code with `--dangerously-skip-permissions` or
   `bypassPermissions` mode against this repo (checked via grep across
   `docs/`, `claude/`, and `plugins/`), so disabling it costs nothing here.
   **Changed in this PR**: added `permissions.disableBypassPermissionsMode:
   "disable"` to `.claude/settings.json`, the checked-in "shared project"
   settings file. Per Claude Code's own
   [settings precedence](https://code.claude.com/docs/en/settings#settings-precedence)
   (highest to lowest: managed, command-line `--settings`, project-local
   `.claude/settings.local.json`, shared project `.claude/settings.json`,
   user), this establishes the repo-wide default: a session started against
   this repo with `--dangerously-skip-permissions` is refused *unless* a
   higher-precedence source overrides it — a contributor's own `--settings`
   flag, or their own project-local `.claude/settings.local.json`, both of
   which outrank this file and are exactly the mechanism the
   `.claude/settings.local.json` finding above already shows can accumulate
   unreviewed grants. The [permissions docs](https://code.claude.com/docs/en/permissions#permission-modes)
   say this setting is "most useful in managed settings, where it can't be
   overridden" — this repo has no managed settings, so what this PR adds is
   a repo-wide default that closes the gap for anyone who hasn't
   deliberately overridden it locally, not an unconditional guarantee.
4. **(Local-only) an overly broad accumulated `Bash(python3 -c ' *)` allow
   rule** in this developer's untracked `.claude/settings.local.json`.
   Documented above as a recommendation; not something this PR can fix,
   since the file isn't repo-tracked.

## Deliberately not changed, and why

- **Full sandboxing (`sandbox.enabled: true`) in the checked-in
  `.claude/settings.json`.** This is available, would be a legitimate
  environment-layer win, and — unlike the credential-masking and
  strict-allowlist sub-settings, which Claude Code only honors from user or
  managed settings — `sandbox.enabled` itself and basic `filesystem`/
  `network` sub-keys *can* be set at the project level and would apply to
  every contributor. It's not enabled here for the same reason
  `docs/prompt-injection-defense.md` already gives for skipping a full
  sandboxed execution environment: this is a single developer's own repo,
  the publish gate is already the highest-leverage control for the actual
  threat model (an injected instruction trying to get something posted
  publicly), and there are no standing credentials Claude can reach in a
  session against this repo that a compromised session couldn't already
  reach via the developer's own shell outside Claude Code. Turning on
  repo-wide sandboxing is also a real behavior change — first-touch network
  domains start prompting, "Bash command (unsandboxed)" labeling appears for
  commands that can't be sandboxed — that's disruptive to land silently as
  part of an audit PR. If the risk surface changes (untrusted external
  contributions at volume, credentials with blast radius beyond this
  developer's own accounts), this doc's own recommendation is to revisit
  sandboxing first, since it's the control that would matter most.
- **A `permissions.deny` list for specific commands** (e.g., denying `curl`/
  `wget` outright, per the pattern the permissions docs suggest as the
  reliable alternative to fragile Bash argument-matching). Not added here
  because this repo's own workflows (screenshot/asset fetching, dependency
  installs, `gh` itself shelling out to HTTPS) rely on outbound network
  access from Bash, and a `deny` rule can't carry allowlist exceptions — the
  docs are explicit that a broad `Bash(curl *)` deny blocks every matching
  call even when a narrower allow also matches. Getting this right without
  breaking documented workflows needs the sandbox's actual domain-allowlist
  mechanism, not a coarse `deny`, which is another point in favor of
  sandboxing being the right next step if this repo's risk profile changes
  rather than a piecemeal `deny` list now.
- **Editing `.claude/settings.local.json`.** Not repo-tracked, not something
  a PR can carry; left as a documented recommendation for the user to act on
  directly.

## Cross-references

- `docs/prompt-injection-defense.md` — the layered defense model this doc
  fills in layer 3 for; see its "environmental layer" bullet, which already
  points here.
- `plugins/dfadler-agent-config/skills/gh-publish-permission/SKILL.md` — the
  human-layer standard `.claude/settings.json`'s `ask` rules enforce.
- `.claude/settings.json` — the file this audit covers; see the diff in this
  PR for the one change (`permissions.disableBypassPermissionsMode`).

## Sources

- Claude Code — [Security](https://code.claude.com/docs/en/security)
- Claude Code — [Sandboxing](https://code.claude.com/docs/en/sandboxing)
- Claude Code — [Permissions](https://code.claude.com/docs/en/permissions)
- Claude Code — [Settings reference](https://code.claude.com/docs/en/settings-reference)
