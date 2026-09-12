# Session-status hook receiver

Prototype for [dfadler/agent-config#172](https://github.com/dfadler/agent-config/issues/172)
(a sub-issue of [#170](https://github.com/dfadler/agent-config/issues/170)): proves that
Claude Code's own **HTTP hooks** can push live session state to a small local
receiver, as an alternative to a dashboard polling or tailing
`~/.claude/projects/*/*.jsonl` — the pattern used by third-party tools like
[`Stargx/claude-code-dashboard`](https://github.com/Stargx/claude-code-dashboard),
`onikan27/claude-code-monitor`, and `yepzdk/claude-sessions-monitor`.

`receiver.py` is a standard-library-only Python HTTP server. It listens for
`Notification`, `Stop`, and `SessionEnd` hook payloads, tracks per-session
status in memory, and prints a live plain-text status table on every update
(also servable over HTTP for scripting).

## Quick start

```bash
python3 receiver.py --port 8787
```

Then, in **a separate scratch project** — never in your real global
`~/.claude/settings.json` (see "Trying this yourself" below) — configure HTTP
hooks pointing at `http://127.0.0.1:8787/hook`. `example-project/.claude/settings.json`
in this directory is a ready-to-copy example:

```json
{
  "hooks": {
    "Notification": [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:8787/hook", "timeout": 5 }] }],
    "Stop":         [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:8787/hook", "timeout": 5 }] }],
    "SessionEnd":   [{ "hooks": [{ "type": "http", "url": "http://127.0.0.1:8787/hook", "timeout": 5 }] }]
  }
}
```

Omitting `matcher` (as above) fires the hook for every occurrence of that
event, per the docs: *"If you omit the matcher or use `*`, the group activates
on every occurrence of the event."* Start a Claude Code session with that
project as its cwd and watch the receiver's table update as the session hits
permission prompts, finishes turns, and exits.

Endpoints:

- `POST /hook` — point a hook here. Valid JSON responds `200 {}` (an
  explicit no-op per the documented JSON output format — none of these
  three events need this receiver to block or alter anything); malformed
  JSON returns `400`.
- `GET /status` — JSON snapshot of every session seen.
- `GET /` — the same data as a plain-text table, so `watch -n1 curl -s
  http://127.0.0.1:8787/` gives a live-refreshing terminal view with no extra
  tooling.

Flags: `--host`, `--port`, `--log-file PATH` (append every raw payload as one
JSON line, for audit/debugging), `--status-file PATH` (write the current
snapshot as JSON on every update, if you'd rather `cat`/`watch cat` a file
than curl an endpoint).

## Docs cited

Hook configuration and payload shapes are documented at
[code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks). Per
this repo's "cite sources for platform-capability claims" convention, the
exact JSON this receiver expects was taken verbatim from that page (fetched
2026-09-08), not guessed from memory or general LLM-tool-call knowledge:

**HTTP hook config shape:**

```json
{
  "type": "http",
  "url": "http://localhost:8080/hooks/pre-tool-use",
  "timeout": 30,
  "headers": { "Authorization": "Bearer $MY_TOKEN" },
  "allowedEnvVars": ["MY_TOKEN"]
}
```

Claude Code POSTs the hook's JSON input as the request body with
`Content-Type: application/json`; the response body uses the same JSON output
format as command hooks. A `200` with an empty body (or `{}`) is treated the
same as a command hook exiting 0 with no output — no decision, normal flow
continues. That's what this receiver always returns.

**Notification input** (`Notification` hooks additionally receive `message`,
optional `title`, and `notification_type`):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission",
  "title": "Permission needed",
  "notification_type": "permission_prompt"
}
```

`agent_needs_input` is a value the `notification_type`/matcher can take on
this same `Notification` event — it is *not* a separate hook event. Per the
docs, it fires "when a background session starts waiting on your input while
Agent View is open in a terminal, or the current session asks you an agent
team teammate's terminal setup question," and requires Claude Code >= 2.1.198.
That precondition (Agent View + a background session, or an agent-team
teammate prompt) is why this prototype's *live* validation exercises a
different, easier-to-trigger `notification_type` instead — see "What was
validated live" below.

**Stop input:**

```json
{
  "session_id": "abc123",
  "transcript_path": "~/.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true,
  "last_assistant_message": "I've completed the refactoring. Here's a summary...",
  "background_tasks": [ { "id": "task-001", "type": "shell", "status": "running", "description": "tail logs", "command": "tail -f /var/log/syslog" } ],
  "session_crons": [ { "id": "cron-001", "schedule": "0 9 * * 1-5", "recurring": true, "prompt": "check the build" } ]
}
```

**SessionEnd input** (matcher filters on `reason`: `clear`, `resume`,
`logout`, `prompt_input_exit`, `other`):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../00893aaf-19fa-41d2-8238-13269b9b3ca0.jsonl",
  "cwd": "/Users/...",
  "hook_event_name": "SessionEnd",
  "reason": "other"
}
```

## What was validated live vs. schema-only

Live, end to end, using a real `claude` CLI process (driven via the
`dfadler-agent-config:detached-terminal` skill so it never stole terminal
focus) with `example-project/.claude/settings.json` wired at
`http://127.0.0.1:8787/hook`, and the receiver's own `--log-file` capturing
the raw payloads as they arrived:

- **`SessionEnd`**, twice, with two different real `reason` values: `"other"`
  (a `claude -p` invocation that was killed) and `"prompt_input_exit"` (typing
  `/exit` in an interactive session).
- **`Notification`**, with `notification_type: "idle_prompt"` and
  `message: "Claude is waiting for your input"` — Claude Code's own
  "waiting for your input" signal, functionally the same category of event as
  `agent_needs_input` (a session waiting on the user) but reachable from an
  ordinary single foreground session, unlike `agent_needs_input` which needs
  Agent View plus a background session.

Not live-validated in this environment: **`Stop`**, and the
`agent_needs_input` `notification_type` specifically. The blocker was
environmental, not a receiver problem — this machine's Claude Code OAuth
session had expired and could not refresh non-interactively (`Failed to
authenticate: OAuth session expired and could not be refreshed`), so no
prompt in the scratch session ever reached the model to produce a completed
turn. `Stop` only fires once Claude finishes responding, so it never fired;
`agent_needs_input` additionally needs Agent View driving a background
session, a heavier setup this prototype didn't attempt once the more basic
model-turn path was already blocked.

For those two, this repo's `scripts/tests/test_session_status_receiver.py`
schema-validates the receiver against the *exact* JSON shapes quoted above
(copied from the docs, not reimplemented from memory), including
`agent_needs_input` specifically — `test_notification_agent_needs_input_marks_session_blocked`
and `test_stop_marks_session_done`. Run it with:

```bash
make venv
.venv/bin/python -m pytest scripts/tests/test_session_status_receiver.py -v
```

If you want to close this gap for real: fix the OAuth session on whatever
machine you're testing from (`claude /login`), then either (a) run a normal
prompt that requires a tool call in a scratch project wired the same way, to
get a live `Stop`, or (b) open Agent View in one terminal, start a background
session in another that ends up waiting on input, and watch for a live
`agent_needs_input` `Notification`.

## Comparison note: hooks vs. tailing `~/.claude/projects/*/*.jsonl`

This is the "worth a quick comparison note" the issue asked for, not a full
implementation of the alternative.

| | HTTP hooks (this prototype) | Tailing the transcript JSONL |
|---|---|---|
| Mechanism | Claude Code pushes a POST the moment an event fires | An external process polls or watches the file for new lines and re-parses |
| Latency | Effectively immediate (network POST, `timeout` defaults to 600s but real delivery is near-instant) | Bounded by poll interval, or by inotify/fswatch latency and JSONL parse cost |
| "Working" visibility | **Not observable** with only these three hooks wired — there's no signal between "session started" and the next `Stop`/`Notification`/`SessionEnd`. Wiring `UserPromptSubmit`/`PreToolUse` would add it, at the cost of one more moving part per event type | **Observable directly** — every new line the model or a tool writes is itself evidence the session is still working, with no extra hook wiring |
| Coupling | Requires editing `.claude/settings.json` per project (or globally) to add hook config | Zero configuration — works against any session's existing transcript file with no opt-in |
| Failure mode | An unreachable receiver just means Claude Code proceeds normally (a `200`/empty response, or the hook timing out, is a no-op) but events are silently dropped from the dashboard's point of view | A malformed or truncated line, or a schema change in the JSONL format, can break the parser; no equivalent of an HTTP status code to signal success/failure per event |
| Setup cost | One receiver process, plus hook config in each project that should report status | A file watcher plus parsing logic that has to track file offsets across restarts and rotations |
| Cross-repo aggregation | Natural — every project's hooks POST to the same receiver URL | Natural too — a watcher can glob `~/.claude/projects/*/*.jsonl`, but has to reconcile "which project is this" from the directory-encoded path |

Net: push-via-hooks gives near-real-time, low-parsing-cost signal for the
handful of events Claude Code already models as "notification-worthy" (needs
input, turn finished, session ended), but says nothing about ongoing
progress. Tailing the JSONL gives continuous progress visibility at the cost
of parsing an internal, not-necessarily-stable transcript format and running
your own file-watching loop. For #170's dashboard layer, the practical answer
is probably both: hooks for the state transitions that matter for triage
("does this session need me right now"), tailing (or `UserPromptSubmit`/
`PreToolUse` hooks) only if per-turn progress detail turns out to matter too.

## Trying this yourself

**Do not add these hooks to your real global `~/.claude/settings.json`** —
that changes every session on your machine, not just a scratch prototype.
Instead:

1. Create a throwaway project directory (or reuse `example-project/` here).
2. Copy `example-project/.claude/settings.json` into that project's
   `.claude/settings.json`, adjusting the port if you changed `--port`.
3. Run `python3 scripts/session-status-hook-receiver/receiver.py`.
4. `cd` into the scratch project and run `claude` normally — trigger a
   permission prompt, let it finish a response, and exit — and watch the
   receiver's table update in your terminal.
5. When done, delete the scratch project (or just its `.claude/settings.json`)
   — nothing here touches your real configuration.

## Tests

`scripts/tests/test_session_status_receiver.py` starts the real receiver on
an ephemeral localhost port and posts payloads copied verbatim from the docs
examples above, covering: `agent_needs_input` marking a session
`needs-input`; `Stop` marking a session `done`; `SessionEnd` marking a session
`ended` with its `reason`; an unrelated `notification_type` (e.g.
`auth_success`) not flipping status; multiple concurrent sessions tracked
independently; the plain-text table and JSON endpoints; a malformed body
returning `400`; and `--status-file` writes. Run via `make test-py` (adds
`receiver.py` and its test to this repo's `PY_SOURCES`, so `make lint-py` and
`make typecheck` cover it too).
