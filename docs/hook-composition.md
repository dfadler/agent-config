# Hook composition protocol

This document describes how `worktree-core`'s hooks are designed to
compose with hooks from other plugins without
producing collisions or conflicting behavior.

## The contract: hooks are additive

Every hook in this plugin is **additive, not exclusive**. A hook does its
specific job and exits; it never assumes it is the only hook registered for
that event, and it never tries to suppress or shortcut hooks from other
plugins. Claude Code runs all matching hooks for an event **in parallel** and merges
their results after they finish. Each hook is responsible only for its own
domain.

## Off by default: opt-in protocol

Every hook is **off by default** — it does nothing at all until a project
explicitly turns it on. This matters because the plugin can be enabled in any
repo, including ones the user doesn't fully control the conventions for (e.g.
a work repo at a new job); the plugin's own worktree workflow should never be
silently forced on a project that hasn't asked for it.

Each hook honors two independent enable signals, checked at two different
scopes:

| Scope | Mechanism |
|---|---|
| Session-level | Env var set before launching `claude` |
| Project-level | Key in the project's `.claude/settings.json` |

Each hook checks its signal near the top of the script, before doing any real
work, and exits 0 immediately (no output, no side effect) unless a signal
explicitly turns it on. Exit 0 with nothing configured means "no opinion" —
the hook did not run at all.

### Enable/disable signals by hook

| Hook | Event | Env var | settings.json key | Default |
|---|---|---|---|---|
| `require-worktree-hook.sh` | `PreToolUse` (Edit/Write) | `WORKTREE_ENFORCE=block\|warn\|off` | `worktree.enforce: "block"\|"warn"\|"off"` | off (no block, no warn) |
| `prune-merged-worktrees-hook.sh` | `SessionStart` | `WORKTREE_AUTO_PRUNE=on\|off` | `worktree.autoPrune: true\|false` | off (skipped entirely) |
| `check-worktree-symlinks-hook.sh` | `SessionStart` | `WORKTREE_SYMLINK_CHECK=on\|off` | `worktree.symlinkCheck: "on"\|"off"` | off (skipped entirely) |
| `memory-hygiene-stop-hook.sh` | `Stop` | `MEMORY_HYGIENE_REMINDER=on\|off` | `env.MEMORY_HYGIENE_REMINDER: "on"` (settings.json's built-in `env` key — no bespoke key; see below) | off (skipped entirely) |

`Stop` fires once per turn, not once per session
([hooks docs](https://code.claude.com/docs/en/hooks#stop)), so
`memory-hygiene-stop-hook.sh` throttles itself to at most one reminder per
session (a marker file keyed on `session_id`) and only fires when `git
status` shows uncommitted changes — see the script's own header for the
full reasoning and known gaps. It has no project-settings key of its own
because the CLI's own settings validation rejects unrecognized top-level
keys (confirmed while building this hook — a `memoryHygiene.reminder` key
was refused as "Unrecognized field"); project-level opt-in instead sets the
env var through settings.json's own `env` field.

For `require-worktree-hook.sh`, `warn` is a middle ground: it prints an
advisory instead of blocking (see the hook script's own header for the full
mode table). For the other two, `off` isn't a distinct third state from the
default — an explicit `off`/`false` still means "don't run", same as leaving
it unconfigured; the two hooks that also support a lighter "nudge, don't act"
mode (`prune-merged-worktrees-hook.sh`'s `--hook` mode) reach it via the
env var's `0`/`false`/`no`/`off` values specifically, distinct from leaving
the signal unset.

### Turning a hook on per project via settings.json

```json
{
  "worktree": {
    "enforce": "block",
    "autoPrune": true,
    "symlinkCheck": "on"
  }
}
```

The settings.json key takes precedence over the default; the env var takes
precedence over settings.json when both are set (env var wins for
session-level overrides).

### Turning a hook on per session via env var

```bash
WORKTREE_ENFORCE=block claude   # enforce worktree usage for this session only
```

## `dfadler-agent-config` and `worktree-core`: a required dependency, not a duplicate

`plugins/worktree-core/` is a minimal, standalone plugin that ships the
git-worktree-usage skill plus these three hooks — no other skills or agents. It is the
single source for both: `dfadler-agent-config` no longer carries its own copy of the
skill or `hooks/hooks.json` (it did until [#334](https://github.com/dfadler/agent-config/issues/334),
when the duplicate was removed). `dfadler-agent-config`'s manifest now declares
`"requires": ["worktree-core"]` to record that dependency, though Claude Code does not
enforce `requires` at load time (see `claude plugin validate`'s warning) — installing
both plugins together (e.g. `./setup.sh --include=dfadler-agent-config,worktree-core`)
is still the user's responsibility.

Since only `worktree-core` registers these hooks now, there is no double-firing to
guard against. A machine that enables `dfadler-agent-config` without also enabling
`worktree-core` simply won't get the worktree hooks (or the skill) at all.

## Guidance for authors of other plugins

If your plugin ships hooks for `PreToolUse` (Edit/Write) or `SessionStart`,
follow the same pattern:

1. **Default to off.** A hook should do nothing — no side effect, no output —
   until the project or session explicitly turns it on. Pick a distinctive
   env var name for your plugin (e.g. `MY_PLUGIN_HOOK=on`) and a
   project-level key in `.claude/settings.json`; check both near the top of
   the script and exit 0 immediately when neither opts in.

2. **Exit 0 to pass, exit 2 with stderr to block.** Exit 0 means "proceed".
   To block, a `PreToolUse` hook must exit **2** and write its message to
   **stderr** — that is the only exit code the official docs describe as
   reliably blocking without printing JSON. Exit 1 (or any other non-zero
   code) with plain-text stdout is a *non-blocking* error: Claude Code shows
   a `<hook name> hook error` notice, but the tool call still proceeds. See
   the "Exit code 2" and "Other exit codes" sections of
   https://code.claude.com/docs/en/hooks. Never exit non-zero just because
   another hook's work is already done.

3. **Don't try to detect or suppress other plugins' hooks.** Assume they
   are running concurrently. If two hooks both check the same condition
   independently, they will produce at most duplicated advisory output — that
   is preferable to a brittle detection mechanism.

4. **Document your enable signal** so projects can configure it in
   `.claude/settings.json`.
