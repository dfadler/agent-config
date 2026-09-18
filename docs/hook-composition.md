# Hook composition protocol

This document describes how `dfadler-agent-config`'s hooks are designed to
compose with hooks from other plugins without
producing collisions or conflicting behavior.

## The contract: hooks are additive

Every hook in this plugin is **additive, not exclusive**. A hook does its
specific job and exits; it never assumes it is the only hook registered for
that event, and it never tries to suppress or shortcut hooks from other
plugins. Claude Code runs all registered hooks for an event in series — that
is the composition model, and each hook is responsible only for its own
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

## Guidance for authors of other plugins

If your plugin ships hooks for `PreToolUse` (Edit/Write) or `SessionStart`,
follow the same pattern:

1. **Default to off.** A hook should do nothing — no side effect, no output —
   until the project or session explicitly turns it on. Pick a distinctive
   env var name for your plugin (e.g. `MY_PLUGIN_HOOK=on`) and a
   project-level key in `.claude/settings.json`; check both near the top of
   the script and exit 0 immediately when neither opts in.

2. **Exit 0 to pass, non-zero to block.** Exit 0 means "proceed"; a non-zero
   exit from a `PreToolUse` hook blocks the tool call (Claude Code convention).
   Never exit non-zero just because another hook's work is already done.

3. **Don't try to detect or suppress other plugins' hooks.** Assume they
   are running concurrently. If two hooks both check the same condition
   independently, they will produce at most duplicated advisory output — that
   is preferable to a brittle detection mechanism.

4. **Document your enable signal** so projects can configure it in
   `.claude/settings.json`.
