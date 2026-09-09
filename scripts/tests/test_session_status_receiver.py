"""Hermetic tests for the session-status hook receiver (issue #172).

Starts the real receiver on an ephemeral localhost port (no network, no real
Claude Code session) and POSTs synthetic payloads shaped exactly like the
JSON examples on https://code.claude.com/docs/en/hooks for the Notification,
Stop, and SessionEnd events, then asserts on the resulting /status snapshot.

This is the schema-validation half of #172's validation story: it proves the
receiver's parsing and status-derivation logic is correct against the
documented payload shape, independent of whether a live Claude Code session
was used to generate the request (see the skill's README for what was also
validated live).
"""

from __future__ import annotations

import json
import sys
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterator

import pytest

sys.path.insert(
    0, str(Path(__file__).resolve().parents[1] / "session-status-hook-receiver")
)

import receiver  # noqa: E402  (path must be extended before this import)


@pytest.fixture()
def server() -> Iterator[str]:
    store = receiver.SessionStore()
    handler = receiver.make_handler(store, log_file=None, status_file=None)
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = str(httpd.server_address[0]), httpd.server_address[1]
    try:
        yield f"http://{host}:{port}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def post_hook(base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/hook",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        assert resp.status == 200
        return dict(json.loads(resp.read().decode("utf-8")))


def get_status(base_url: str) -> list[Dict[str, Any]]:
    with urllib.request.urlopen(f"{base_url}/status", timeout=5) as resp:
        result: list[Dict[str, Any]] = json.loads(resp.read().decode("utf-8"))
        return result


def test_notification_agent_needs_input_marks_session_blocked(server: str) -> None:
    # Payload shape taken verbatim from the Notification example on
    # https://code.claude.com/docs/en/hooks, with notification_type swapped
    # to agent_needs_input (the value #172 asks for specifically).
    post_hook(
        server,
        {
            "session_id": "abc123",
            "transcript_path": "/Users/x/.claude/projects/p/abc123.jsonl",
            "cwd": "/Users/x/project",
            "hook_event_name": "Notification",
            "message": "Claude needs your permission",
            "title": "Permission needed",
            "notification_type": "agent_needs_input",
        },
    )

    (session,) = get_status(server)
    assert session["session_id"] == "abc123"
    assert session["status"] == receiver.STATUS_NEEDS_INPUT
    assert session["notification_type"] == "agent_needs_input"
    assert session["message"] == "Claude needs your permission"


def test_stop_marks_session_done(server: str) -> None:
    # Payload shape from the Stop example in the same docs page.
    post_hook(
        server,
        {
            "session_id": "abc123",
            "transcript_path": "/Users/x/.claude/projects/p/abc123.jsonl",
            "cwd": "/Users/x/project",
            "permission_mode": "default",
            "hook_event_name": "Stop",
            "stop_hook_active": True,
            "last_assistant_message": "I've completed the refactoring.",
        },
    )

    (session,) = get_status(server)
    assert session["status"] == receiver.STATUS_DONE
    assert session["message"] == "I've completed the refactoring."


def test_sessionend_marks_session_ended_with_reason(server: str) -> None:
    # Payload shape from the SessionEnd example in the same docs page.
    post_hook(
        server,
        {
            "session_id": "abc123",
            "transcript_path": "/Users/x/.claude/projects/p/abc123.jsonl",
            "cwd": "/Users/x/project",
            "hook_event_name": "SessionEnd",
            "reason": "other",
        },
    )

    (session,) = get_status(server)
    assert session["status"] == receiver.STATUS_ENDED
    assert session["end_reason"] == "other"


def test_notification_permission_prompt_also_marks_needs_input(server: str) -> None:
    # permission_prompt is a normal, easy-to-trigger Notification type (any
    # PreToolUse permission dialog fires it) -- the receiver treats it as a
    # "needs input" signal too so a single foreground session can exercise
    # the same code path that agent_needs_input would, without requiring
    # Agent View plus a background session. See the README's live-validation
    # notes for why this matters.
    post_hook(
        server,
        {
            "session_id": "abc123",
            "hook_event_name": "Notification",
            "cwd": "/Users/x/project",
            "message": "Claude needs your permission",
            "title": "Permission needed",
            "notification_type": "permission_prompt",
        },
    )

    (session,) = get_status(server)
    assert session["status"] == receiver.STATUS_NEEDS_INPUT


def test_unrelated_notification_type_does_not_flip_status(server: str) -> None:
    # First get the session into a known "done" state...
    post_hook(
        server,
        {
            "session_id": "abc123",
            "hook_event_name": "Stop",
            "cwd": "/Users/x/project",
        },
    )
    # ...then a Notification type that isn't a "needs input" signal (e.g.
    # auth_success) should be recorded but must not flip status back to
    # needs-input.
    post_hook(
        server,
        {
            "session_id": "abc123",
            "hook_event_name": "Notification",
            "cwd": "/Users/x/project",
            "notification_type": "auth_success",
            "message": "Signed in",
        },
    )

    (session,) = get_status(server)
    assert session["status"] == receiver.STATUS_DONE
    assert session["notification_type"] == "auth_success"


def test_multiple_concurrent_sessions_tracked_independently(server: str) -> None:
    post_hook(
        server,
        {
            "session_id": "session-a",
            "hook_event_name": "Notification",
            "cwd": "/repo-a",
            "notification_type": "agent_needs_input",
            "message": "needs input",
        },
    )
    post_hook(
        server,
        {
            "session_id": "session-b",
            "hook_event_name": "Stop",
            "cwd": "/repo-b",
        },
    )

    sessions = {s["session_id"]: s for s in get_status(server)}
    assert sessions["session-a"]["status"] == receiver.STATUS_NEEDS_INPUT
    assert sessions["session-a"]["cwd"] == "/repo-a"
    assert sessions["session-b"]["status"] == receiver.STATUS_DONE
    assert sessions["session-b"]["cwd"] == "/repo-b"


def test_root_endpoint_renders_text_table(server: str) -> None:
    post_hook(
        server,
        {
            "session_id": "abc123",
            "hook_event_name": "SessionEnd",
            "cwd": "/Users/x/project",
            "reason": "other",
        },
    )

    with urllib.request.urlopen(f"{server}/", timeout=5) as resp:
        text = resp.read().decode("utf-8")
    assert "SESSION" in text
    assert "abc123"[:12] in text
    assert receiver.STATUS_ENDED in text


def test_empty_table_before_any_events(server: str) -> None:
    with urllib.request.urlopen(f"{server}/", timeout=5) as resp:
        text = resp.read().decode("utf-8")
    assert "No sessions observed yet" in text


def test_malformed_json_body_returns_400(server: str) -> None:
    req = urllib.request.Request(
        f"{server}/hook",
        data=b"{not json",
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
        raise AssertionError("expected HTTPError for malformed JSON")
    except urllib.error.HTTPError as exc:
        assert exc.code == 400


def test_status_file_is_written_on_update(tmp_path: Path) -> None:
    status_file = tmp_path / "status.json"
    store = receiver.SessionStore()
    handler = receiver.make_handler(store, log_file=None, status_file=str(status_file))
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    host, port = str(httpd.server_address[0]), httpd.server_address[1]
    base_url = f"http://{host}:{port}"

    try:
        post_hook(
            base_url,
            {
                "session_id": "abc123",
                "hook_event_name": "Stop",
                "cwd": "/Users/x/project",
            },
        )
        # The write happens synchronously in the request handler before it
        # responds, so no polling/sleep should be necessary -- assert that
        # directly rather than papering over a race with a wait loop.
        assert status_file.exists()
        data = json.loads(status_file.read_text())
        assert data[0]["session_id"] == "abc123"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def test_render_table_smoke() -> None:
    # Exercises render_table directly (rather than only via HTTP) for the
    # column-width computation with rows of very different lengths.
    rows = [
        {
            "session_id": "short",
            "status": receiver.STATUS_NEEDS_INPUT,
            "event_count": 3,
            "last_event": "Notification",
            "cwd": "/a/very/long/path/that/should/be/right-truncated/repo",
            "message": "blocked on a permission prompt",
            "end_reason": None,
            "notification_type": "agent_needs_input",
        }
    ]
    table = receiver.render_table(rows)
    assert "SESSION" in table
    assert "short" in table


def test_main_rejects_unknown_args_cleanly() -> None:
    with pytest.raises(SystemExit):
        receiver.parse_args(["--not-a-real-flag"])
