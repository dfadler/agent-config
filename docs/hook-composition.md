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

## Inhibit protocol

Every hook honors two independent inhibit signals so it can be turned off at
two different scopes without disabling the entire plugin:

| Scope | Mechanism |
|---|---|
| Session-level | Env var set before launching `claude` |
| Project-level | Key in the project's `.claude/settings.json` under `env` |

Each hook checks its inhibit signal near the top of the script, before doing
any real work, and exits 0 immediately when the signal is set. Exit 0 means
"no opinion" — the hook did not block and did not produce output.

### Inhibit signals by hook

| Hook | Event | Env var | settings.json key |
|---|---|---|---|
| `require-worktree-hook.sh` | `PreToolUse` (Edit/Write) | `WORKTREE_ENFORCE=off` | `worktree.enforce: "off"` |
| `prune-merged-worktrees-hook.sh` | `SessionStart` | `WORKTREE_AUTO_PRUNE=off` | `worktree.autoPrune: false` |
| `check-worktree-symlinks-hook.sh` | `SessionStart` | `WORKTREE_SYMLINK_CHECK=off` | `worktree.symlinkCheck: "off"` |

`WORKTREE_ENFORCE` also accepts `warn` to downgrade the block to an advisory
message (see the hook script's own header for the full mode table).

### Per-project opt-out via settings.json

To disable a hook for a specific project, set the corresponding key under
`env` in that project's `.claude/settings.json`:

```json
{
  "env": {
    "WORKTREE_ENFORCE": "off",
    "WORKTREE_SYMLINK_CHECK": "off"
  }
}
```

Or, for hooks that read settings.json natively, use the `worktree` object:

```json
{
  "worktree": {
    "enforce": "off",
    "autoPrune": false,
    "symlinkCheck": "off"
  }
}
```

Both forms are equivalent; the settings.json key takes precedence over the
env var only when the env var is not set (env var wins for session-level
overrides).

### Per-session opt-out via env var

```bash
WORKTREE_ENFORCE=off claude   # skip worktree enforcement for this session
```

## Guidance for authors of other plugins

If your plugin ships hooks for `PreToolUse` (Edit/Write) or `SessionStart`,
follow the same pattern:

1. **Check an inhibit signal early.** Pick a distinctive env var name for
   your plugin (e.g. `MY_PLUGIN_HOOK=off`) and exit 0 immediately
   when it is set. Optionally also read a project-level key from
   `.claude/settings.json`.

2. **Exit 0 to pass, non-zero to block.** Exit 0 means "proceed"; a non-zero
   exit from a `PreToolUse` hook blocks the tool call (Claude Code convention).
   Never exit non-zero just because another hook's work is already done.

3. **Don't try to detect or suppress other plugins' hooks.** Assume they
   are running concurrently. If two hooks both check the same condition
   independently, they will produce at most duplicated advisory output — that
   is preferable to a brittle detection mechanism.

4. **Document your inhibit signal** so projects can configure it in
   `.claude/settings.json`.
