# Hook composition protocol

This document describes how `worktree-core`'s hooks are designed to
compose with hooks from other plugins without
producing collisions or conflicting behavior, and how `setup.sh`/`teardown.sh`
edit the shared config files those hooks are registered in without clobbering
configuration other tools own.

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

The three `worktree-core` hooks below share one mechanism for this: each
calls `resolveEnableMode(ctx, { envVar, fromSettings, fallback, valid })`
in `plugins/worktree-core/scripts/ts/worktree-hook-lib.ts`, which resolves env var override → settings.json
value → default, validating against the hook's own `valid` list. See that
function's own doc comment for the exact
precedence and validation rules — this table documents only the values each
hook passes in, not the mechanism itself.

### Enable/disable signals by hook

| Hook | Event | Env var | settings.json key | Default |
|---|---|---|---|---|
| `require-worktree-hook.ts` | `PreToolUse` (Edit/Write) | `WORKTREE_ENFORCE=block\|warn\|off` | `worktree.enforce: "block"\|"warn"\|"off"` | off (no block, no warn) |
| `prune-merged-worktrees-hook.ts` | `SessionStart` | `WORKTREE_AUTO_PRUNE=on\|off` | `worktree.autoPrune: true\|false` | off (skipped entirely) |
| `check-worktree-symlinks-hook.ts` | `SessionStart` | `WORKTREE_SYMLINK_CHECK=on\|off` | `worktree.symlinkCheck: "on"\|"off"` | off (skipped entirely) |
| `memory-hygiene-stop-hook.ts` | `Stop` | `MEMORY_HYGIENE_REMINDER=on\|off` | `env.MEMORY_HYGIENE_REMINDER: "on"` (settings.json's built-in `env` key — no bespoke key; see below) | off (skipped entirely) |

`memory-hygiene-stop-hook.ts` belongs to a different plugin (`memory-hygiene`,
not `worktree-core`) and does not use the worktree hook lib — it hand-rolls its
own on/off check. `Stop` fires once per turn, not once per session
([hooks docs](https://code.claude.com/docs/en/hooks#stop)), so the hook
throttles itself to at most one reminder per session (a marker file keyed on
`session_id`) and only fires when `git status` shows uncommitted changes —
see the script's own header for the full reasoning and known gaps. It has no
project-settings key of its own because the CLI's own settings validation
rejects unrecognized top-level keys (confirmed while building this hook — a
`memoryHygiene.reminder` key was refused as "Unrecognized field");
project-level opt-in instead sets the env var through settings.json's own
`env` field.

The `worktree-core` hooks run as `node <script>.ts` in exec form (`"command":
"node", "args": [...]`; [hooks docs](https://code.claude.com/docs/en/hooks)).
`require-worktree-hook` is a guard: an internal failure exits 2 (blocks) so a
crashed guard cannot silently stop enforcing. The two `SessionStart` hooks are
informational and fail open (exit 0).

For `require-worktree-hook.ts`, `warn` is a middle ground: it prints an
advisory instead of blocking (see the hook script's own header for the full
mode table). For the other two, `off` isn't a distinct third state from the
default — an explicit `off`/`false` still means "don't run", same as leaving
it unconfigured; `prune-merged-worktrees-hook.ts`'s lighter "nudge, don't
act" mode (its `--hook` flag) is reached via the env var's or settings'
`0`/`false`/`no`/`off` values specifically, distinct from leaving the signal
unset entirely (which skips the prune script altogether — see that hook's
own header for why "unconfigured" and "off" are different outcomes there).

`prune-merged-worktrees-hook.ts` also reads one settings.json key that isn't
an on/off signal at all and so isn't in the table above:
`worktree.autoPruneCruftMarkers`, an array of `{"path", "beginMarker",
"endMarker"}` entries naming tracked files some tool regenerates a
marker-delimited block into (see the prune script's own header and
`SKILL.md` for the full mechanism). `endMarker` is required — an entry
missing it is silently ignored rather than falling back to "everything from
`beginMarker` to EOF." It's read via `read_cruft_markers` directly, not
`resolve_enable_mode` — there's no on/off state to resolve, only "which
files, if any." Empty/absent by default, and inert unless `autoPrune` is
also on.

### Turning a hook on per project via settings.json

```json
{
  "worktree": {
    "enforce": "block",
    "autoPrune": true,
    "autoPruneCruftMarkers": [
      {
        "path": "CLAUDE.md",
        "beginMarker": "<!-- BEGIN:some-marker -->",
        "endMarker": "<!-- END:some-marker -->"
      }
    ],
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

## `setup.sh`/`teardown.sh`: never clobber configuration they don't own

The hooks above get registered into `~/.claude/settings.json`, a file other
tools also write to directly — for example `rtk init -g` (the `rtk-ai` CLI)
adds its own `PreToolUse`/`Bash` hook there. `setup.sh` and `teardown.sh`
never rewrite that file, `~/.claude/CLAUDE.md`, or the symlink directories
wholesale; each editor only touches the slice of a shared file it can prove
it owns, identified by an explicit marker:

| Shared location | Ownership marker | Where |
|---|---|---|
| `~/.claude/settings.json` (`hooks.<EVENT>`) | Exact `command` string match against this repo's own hook table (`scripts/plugin-hooks.sh`) | `ensure_hook_registered`/`ensure_hook_deregistered` in `scripts/settings-lib.sh` |
| `~/.claude/CLAUDE.md` | `MANAGED_BEGIN`/`MANAGED_END` marker pair | `ensure_claude_md_includes()` (`setup.sh`), `restore_claude_md()` (`teardown.sh`) |
| `~/.claude/CLAUDE.personal.md` (empty placeholder) | `.setup-managed` sidecar file | `migrate_personal_claude_md()` (`setup.sh`), checked in `restore_claude_md()` (`teardown.sh`) |
| `~/.claude/{commands,skills,agents}/*` | Resolved symlink target falls under this repo's root | `link()`/`prune_stale_plugin_links()` (`setup.sh`), `unlink_if_owned`/`unlink_dir_contents` (`teardown.sh`) |

Concretely for `settings.json`: `ensure_hook_registered` only appends a new
entry under `hooks.<EVENT>`, and `ensure_hook_deregistered` only removes
entries whose `command` exactly matches one of this repo's own hook commands.
Neither function ever inspects or touches an entry it doesn't recognize —
so a hook added by `rtk`, another skills-dir plugin, or hand-edited settings
survives `./setup.sh`/`./teardown.sh` runs untouched. The same rule applies
to `CLAUDE.md`: content outside the managed markers (a user's own notes, or
another tool's own append) is preserved verbatim on every re-run, and to the
symlink directories: a real file or a symlink pointing outside this repo is
left alone with a warning rather than replaced.

## `dfadler-agent-config` and `worktree-core`: companion plugins, not a declared dependency

`plugins/worktree-core/` is a minimal, standalone plugin that ships the
git-worktree-usage skill plus these three hooks — no other skills or agents. It is the
single source for both: `dfadler-agent-config` no longer carries its own copy of the
skill or `hooks/hooks.json` (it did until [#334](https://github.com/dfadler/agent-config/issues/334),
when the duplicate was removed). The two are meant to be installed together (a plain
`./setup.sh` installs everything; to pick, use
`./setup.sh --include=dfadler-agent-config,worktree-core`). Nothing in
`dfadler-agent-config` calls `worktree-core` at runtime, so a machine that enables one
without the other still works; it just lacks the worktree hooks and skill.

`dfadler-agent-config`'s manifest does **not** declare `worktree-core` under
`"dependencies"`. It did briefly ([#438](https://github.com/dfadler/agent-config/pull/438);
before that it said `"requires"`, which isn't a Claude Code field). Per the
[plugin dependencies docs](https://code.claude.com/docs/en/plugins/dependencies), a
declared dependency is enforced at load time: a plugin whose dependency is disabled or
absent doesn't load. It is also not resolved inside a `claude plugin eval` run, where the
plugin under test is silently dropped ([#450](https://github.com/dfadler/agent-config/issues/450)).
With nothing in the plugin needing `worktree-core`, enforcing it protected nothing and
blocked evals for its skills (#409, #410).

Since only `worktree-core` registers these hooks now, there is no double-firing to
guard against.

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
