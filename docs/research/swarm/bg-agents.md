# `claude --bg` and `claude agents --json` contract

Research for #1079 (part of #1071). Checked 2026-11-10 against installed Claude Code 2.1.321.
Status: agent view is a **research preview** (introduced v2.1.139). The page says "The interface and keyboard shortcuts may change" ([agent-view](https://code.claude.com/docs/en/agent-view)).

Sources: AV = https://code.claude.com/docs/en/agent-view, CLI = https://code.claude.com/docs/en/cli-reference, CL = https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md (only the first ~100k chars read, so entries before 2.1.311 were not checked there), HELP = `claude --help` / `claude agents --help` on 2.1.321. Fetched pages were summarised by a small model, so quotes are as relayed.

## `claude --bg` accepts and refuses

- Prompt is the positional argument, not a `-p` value. `--bg` with `-p`/`--print` is rejected before any session is created (AV; CLI `--bg` row). Rejection appeared in v2.1.198 (AV version table).
- Ambiguous position (for example after combined short flags): exits with `Couldn't tell whether --bg is a flag or text here`; since v2.1.299 `--bg` is read as a flag only before a bare `--` and outside another flag's value (AV).
- Accepted alongside: `--agent` (unknown name fails the launch, v2.1.191), `--name`, `--exec '<cmd>'` (PTY job instead of a Claude session), `--model`, `--resume <id>` (continue same ID or start a copy with a `note:`, v2.1.257; `--fork-session` forces a copy) (AV, CLI).
- Checks workspace trust first (v2.1.281); in a script with no dialog possible it exits `Workspace not trusted` (AV, CLI).
- `--max-turns`, `--max-budget-usd`: CLI marks both "print mode only"; `--bg` refuses `-p`, so per the docs they cannot apply to a `--bg` session. The docs never state this combination explicitly, so this is an inference. Unconfirmed beyond that.
- `--worktree`: AV does not document `--bg --worktree`. CL 2.1.321 says "Improved the agent view's row for a `claude --bg --worktree` session that couldn't set up its worktree", which implies it is accepted. Default instead: a `--bg` session starts in the cwd and moves itself into `.claude/worktrees/` before editing; `worktree.bgIsolation: "none"` in `.claude/settings.json` turns that off (AV; setting added v2.1.143).
- `--permission-mode` with `--bg`: not a documented `--bg` option in AV. Documented: a `--bg` session "starts the way a new `claude` session in that directory would" (so `permissions.defaultMode`); `claude agents --permission-mode` sets defaults for dispatched sessions (accepted since v2.1.142; CL 2.1.321 fixed it being ignored). `--dangerously-skip-permissions` with `--bg` persists across supervisor restarts (CLI). Whether bare `claude --permission-mode X --bg` is honoured: unconfirmed.
- Printed on success, e.g. `backgrounded · 7c5dcf5d · flaky-test-fix` then hint lines for `agents`/`attach`/`logs`/`stop` (AV; HELP). The id is an 8-hex short id.

## `claude agents --json [--all] [--cwd <path>]`

HELP: "Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)". `--all`: "With --json: also include completed background sessions". Without `--all`: live sessions plus background sessions still working or blocked even if the process exited (AV). Put `--add-dir`/`--mcp-config` after `agents` or it errors `unknown option` (AV).

Fields (AV):
- always: `cwd`, `kind` (`interactive` or `background`), `startedAt` (Unix ms).
- background only: `id` (short id), `state`.
- while process alive: `pid`, `status`.
- `waitingFor` when `status` is `waiting`.
- `sessionId`: full UUID, usable with `claude --resume`. `name` when set.
- `state`: `working`, `blocked`, `done`, `failed`, `stopped`. `blocked` always means it needs you; a finished turn awaiting the next instruction is `done`.
- `status`: `busy`, `waiting`, `idle`.
- `waitingFor`: `permission prompt`, `input needed`, `sandbox request`, `worker request`, `dialog open`.
- Interactive sessions never named get a default name like `my-app-3f` (v2.1.196).

Observed locally on 2.1.321 (matches docs): interactive entries have `pid, cwd, kind, startedAt, sessionId, name, status`; a finished background entry has `id, cwd, kind:"background", startedAt, sessionId, state:"done"` and no `pid`/`status`.

## attach / logs / stop / rm (AV "Manage sessions from the shell", HELP)

- `claude attach <id|name>`: opens in this terminal; by name only while running; partial name since v2.1.290.
- `claude logs <id|name>`: prints recent terminal output.
- `claude stop|kill <id>`: stops; conversation kept, `attach` or `--resume` reopens it.
- `claude rm <id>`: deletes session and its worktree when safe; works on exited sessions; transcript stays resumable. Refused over unpushed commits unless `--discard-unpushed <commit>@<worktree-id>` (v2.1.260); `--force-remove-worktree <worktree-id>` (v2.1.268).
- Also `claude respawn <id>|--all`, `claude daemon status|logs|run|stop --any [--keep-workers]` (CLI).

## What the supervisor survives (AV "The supervisor process")

- Terminal or shell close, closing agent view, starting new interactive sessions: survives; a separate supervisor process runs the sessions.
- Sleep: sessions preserved, processes resume on wake.
- Auto-update and supervisor restart: state persists on disk.
- Shutdown or restart of the machine: stops running sessions. Stopped within 48h shows `failed`; longer shows `stopped` with `ended while the background service was off` (v2.1.248).
- Supervisor itself killed (macOS/Linux): sessions stop unless a new supervisor connects within about a minute; `claude agents` starts one. Since v2.1.295 an exiting `claude agents` does not start one on its own.
- Idle or finished sessions unattached about an hour have their process stopped; pin to keep.
- AV "Limitations": sessions are local, stop on shutdown, consume subscription quota like interactive sessions.

## Running without a GUI login session

Not addressed. AV has no mention of login session, launchd, systemd, headless, or a no-GUI host (its one SSH mention is about hyperlinks). Nearest facts: the supervisor is started on demand by `claude --bg`/`claude agents`, not installed as a service (`claude daemon stop --any` "confirms stopping an on-demand supervisor, which is the default", CLI); it authenticates from stored credentials (`/login`, or an API key exported in the shell that starts the supervisor); macOS Files and Folders / Local Network permission prompts apply per background host. Whether sessions run with no logged-in macOS user: **unconfirmed**. AV characters 100k-148k were read only for troubleshooting, limitations and version history.

## `~/.claude/jobs/`

AV: "The files under `~/.claude/jobs/<id>/` are not a stable interface." Layout (also unstable): `~/.claude/jobs/<id>/state.json`, `tmp/` (removed on delete), `~/.claude/daemon/roster.json`, `~/.claude/daemon.log`; `CLAUDE_JOB_DIR` is set per session; `CLAUDE_CONFIG_DIR` moves the base and runs a separate supervisor. For scripts, use `claude agents --json`, not the files.

## Version table (from AV)

139 introduced; 141 `--cwd`; 142 agents flags; 143 `bgIsolation`; 191 `--agent` not-found fails; 198 `--bg`+`-p` rejected; 257 `--resume ... --bg` semantics; 281 trust check; 290 partial names, `attach` by name; 295 no auto supervisor on exit; 299 `--bg` flag parsing; 321 `claude agents --permission-mode` fix, `--bg --worktree` row.

## Caveats

- Researching this ran `claude --bg --help` by mistake: it started an idle background session (id 76191361, now `state: done`, cwd this worktree) instead of printing help. It was not removed (`claude rm` was blocked by the permission classifier); the owner may run `claude rm 76191361`.
