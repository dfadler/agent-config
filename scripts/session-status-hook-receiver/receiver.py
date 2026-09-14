#!/usr/bin/env python3
"""Minimal HTTP receiver for Claude Code session-status hooks.

Prototype for dfadler/agent-config#172 (sub-issue of #170): proves that
Claude Code's own HTTP hooks can push live session state to a small local
receiver instead of a dashboard polling or tailing
``~/.claude/projects/*/*.jsonl`` (the pattern used by third-party tools like
Stargx/claude-code-dashboard, onikan27/claude-code-monitor, and
yepzdk/claude-sessions-monitor).

Wire it up by pointing an HTTP hook at ``POST http://<host>:<port>/hook`` for
the ``Notification``, ``Stop``, and ``SessionEnd`` events (see
``example-project/.claude/settings.json`` for a working example, and this
directory's README for the full setup and validation notes). Payload shapes
are documented at https://code.claude.com/docs/en/hooks and were confirmed
against that page's own JSON examples for each event on 2026-09-08 (see the
README's "Docs cited" section) -- notably that ``agent_needs_input`` is a
*matcher value* on the ``Notification`` event, not a distinct event on its
own; a session id shows up in the payload as top-level ``session_id`` on
every event.

No third-party dependencies -- standard library only, so this can run
anywhere Python 3.9+ is available.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional, TextIO

# Notification `notification_type` values that mean "a human needs to look at
# this session." `agent_needs_input` is the one #172 asks for specifically --
# it only fires for a background session while Agent View is open, or for an
# agent-team teammate's terminal setup question (Claude Code >= 2.1.198). The
# other two are included so the receiver produces visible "blocked" signals
# from an ordinary single foreground session too, which is what makes this
# prototype file-checkable end to end without standing up Agent View plus a
# background session -- see the README's "What was validated live" section.
NEEDS_INPUT_NOTIFICATION_TYPES = {
    "agent_needs_input",
    "permission_prompt",
    "idle_prompt",
}

# Terminal-ish statuses this receiver can assign to a session, derived only
# from the three wired hook events (no PreToolUse/UserPromptSubmit signal is
# collected). "working" is therefore never observed directly -- see the
# README's comparison note on why that is an inherent limitation of this
# minimal 3-hook wiring, not a bug.
STATUS_UNKNOWN = "unknown"
STATUS_NEEDS_INPUT = "needs-input"
STATUS_DONE = "done"
STATUS_ENDED = "ended"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class SessionState:
    session_id: str
    cwd: str = ""
    status: str = STATUS_UNKNOWN
    last_event: str = ""
    notification_type: Optional[str] = None
    message: Optional[str] = None
    end_reason: Optional[str] = None
    first_seen: str = field(default_factory=now_iso)
    last_updated: str = field(default_factory=now_iso)
    event_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "cwd": self.cwd,
            "status": self.status,
            "last_event": self.last_event,
            "notification_type": self.notification_type,
            "message": self.message,
            "end_reason": self.end_reason,
            "first_seen": self.first_seen,
            "last_updated": self.last_updated,
            "event_count": self.event_count,
        }


class SessionStore:
    """Thread-safe in-memory table of session_id -> SessionState.

    ThreadingHTTPServer dispatches each request on its own thread, and
    multiple concurrent Claude Code sessions will POST here independently,
    so every read/write goes through this lock.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: Dict[str, SessionState] = {}

    def apply_hook_payload(self, payload: Dict[str, Any]) -> SessionState:
        session_id = str(payload.get("session_id") or "unknown")
        hook_event_name = str(payload.get("hook_event_name") or "")
        cwd = str(payload.get("cwd") or "")

        with self._lock:
            state = self._sessions.get(session_id)
            if state is None:
                state = SessionState(session_id=session_id)
                self._sessions[session_id] = state

            state.cwd = cwd or state.cwd
            state.last_event = hook_event_name
            state.last_updated = now_iso()
            state.event_count += 1

            if hook_event_name == "Notification":
                notification_type = payload.get("notification_type")
                state.notification_type = (
                    str(notification_type) if notification_type else None
                )
                message = payload.get("message")
                state.message = str(message) if message else None
                if notification_type in NEEDS_INPUT_NOTIFICATION_TYPES:
                    state.status = STATUS_NEEDS_INPUT
            elif hook_event_name == "Stop":
                state.status = STATUS_DONE
                last_assistant_message = payload.get("last_assistant_message")
                if last_assistant_message:
                    state.message = str(last_assistant_message)[:200]
            elif hook_event_name == "SessionEnd":
                state.status = STATUS_ENDED
                reason = payload.get("reason")
                state.end_reason = str(reason) if reason else None

            return state

    def snapshot(self) -> List[Dict[str, Any]]:
        with self._lock:
            rows = [s.to_dict() for s in self._sessions.values()]
        rows.sort(key=lambda r: r["last_updated"], reverse=True)
        return rows


def render_table(sessions: List[Dict[str, Any]]) -> str:
    if not sessions:
        return "No sessions observed yet. Waiting for hook events...\n"

    headers = ["SESSION", "STATUS", "EVENTS", "LAST EVENT", "CWD", "DETAIL"]
    rows = []
    for s in sessions:
        detail = s["message"] or s["end_reason"] or s["notification_type"] or ""
        rows.append(
            [
                str(s["session_id"])[:12],
                str(s["status"]),
                str(s["event_count"]),
                str(s["last_event"]),
                str(s["cwd"])[-30:],
                detail[:40],
            ]
        )

    widths = [
        max(len(headers[i]), *(len(row[i]) for row in rows))
        for i in range(len(headers))
    ]
    lines = [
        "  ".join(h.ljust(w) for h, w in zip(headers, widths)),
        "  ".join("-" * w for w in widths),
    ]
    for row in rows:
        lines.append("  ".join(c.ljust(w) for c, w in zip(row, widths)))
    return "\n".join(lines) + "\n"


def make_handler(
    store: SessionStore, log_file: Optional[TextIO], status_file: Optional[str]
) -> type:
    log_file_lock = threading.Lock()
    status_file_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "SessionStatusReceiver/1.0"

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
            # Keep stdout limited to the status table; access logs would
            # otherwise interleave with it. Uncomment for debugging:
            # sys.stderr.write("%s - - [%s] %s\n" % (
            #     self.address_string(), self.log_date_time_string(), format % args))
            pass

        def _write_status_file(self) -> None:
            if not status_file:
                return
            try:
                payload = json.dumps(store.snapshot(), indent=2)
                directory = os.path.dirname(os.path.abspath(status_file))
                with status_file_lock:
                    fd, tmp = tempfile.mkstemp(dir=directory, suffix=".tmp")
                    try:
                        with os.fdopen(fd, "w", encoding="utf-8") as f:
                            f.write(payload)
                        os.replace(tmp, status_file)
                    except BaseException:
                        os.unlink(tmp)
                        raise
            except OSError as exc:
                sys.stderr.write(f"warning: could not write status file: {exc}\n")

        def do_POST(self) -> None:  # noqa: N802
            if self.path != "/hook":
                self.send_response(404)
                self.end_headers()
                return

            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""

            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except (json.JSONDecodeError, UnicodeDecodeError) as exc:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(exc)}).encode("utf-8"))
                return

            if log_file is not None:
                with log_file_lock:
                    log_file.write(json.dumps(payload) + "\n")
                    log_file.flush()

            state = store.apply_hook_payload(payload)
            self._write_status_file()

            sys.stdout.write("\033[2J\033[H")  # clear screen, home cursor
            sys.stdout.write(render_table(store.snapshot()))
            sys.stdout.flush()

            # Empty JSON object == "no decision," which command hooks signal
            # by exiting 0 with no stdout. None of Notification/Stop/
            # SessionEnd need this receiver to block or alter anything, so an
            # empty object is the correct, documented no-op response.
            body = json.dumps({}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            _ = state  # state is applied for its side effect above

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/status":
                body = json.dumps(store.snapshot(), indent=2).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.path == "/":
                body = render_table(store.snapshot()).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_response(404)
            self.end_headers()

    return Handler


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Minimal local receiver for Claude Code Notification/Stop/"
            "SessionEnd HTTP hooks. Prints a live session-status table to "
            "stdout on every event; GET / and GET /status serve the same "
            "data over HTTP for `watch curl` or scripting."
        )
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)"
    )
    parser.add_argument(
        "--port", type=int, default=8787, help="Bind port (default: 8787)"
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Append every raw hook payload as one JSON line to this file",
    )
    parser.add_argument(
        "--status-file",
        default=None,
        help="Write the current session-status snapshot as JSON to this file on every update",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])

    store = SessionStore()
    log_file: Optional[TextIO] = None
    if args.log_file:
        log_file = open(args.log_file, "a", encoding="utf-8")  # noqa: SIM115

    handler = make_handler(store, log_file, args.status_file)
    server = ThreadingHTTPServer((args.host, args.port), handler)

    sys.stdout.write(
        f"session-status-hook-receiver listening on http://{args.host}:{args.port}\n"
        f"  POST /hook   -- point Notification/Stop/SessionEnd HTTP hooks here\n"
        f"  GET  /status -- JSON snapshot of every session seen\n"
        f"  GET  /       -- plain-text status table (use with `watch curl -s ...`)\n"
    )
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if log_file is not None:
            log_file.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
