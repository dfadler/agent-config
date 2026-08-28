"""Tests for the detached-terminal implementation.

The integration tests start real daemons holding real PTYs. They are hermetic
in the ways that matter: AGENT_TERM_STATE is redirected into a tmp directory so
nothing touches ~/.claude or a developer's live sessions, every session is torn
down in a fixture, and the programs driven are `cat` and `bash --norc` rather
than anything that reaches the network.
"""

from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest

# A CLI runner: takes argv fragments, returns the finished process.
Runner = Callable[..., "subprocess.CompletedProcess[str]"]

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = (
    REPO_ROOT
    / "plugins"
    / "dfadler-agent-config"
    / "skills"
    / "detached-terminal"
    / "scripts"
    / "agent_term.py"
)


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location("agent_term", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


agent_term = _load_module()


# ---------------------------------------------------------------- unit tests


class TestEncodeKey:
    def test_named_keys(self) -> None:
        assert agent_term.encode_key("Enter") == b"\r"
        assert agent_term.encode_key("Escape") == b"\x1b"
        assert agent_term.encode_key("Up") == b"\x1b[A"

    def test_control_keys(self) -> None:
        assert agent_term.encode_key("C-c") == b"\x03"
        assert agent_term.encode_key("C-a") == b"\x01"

    def test_meta_keys(self) -> None:
        assert agent_term.encode_key("M-x") == b"\x1bx"

    def test_literal_text_passes_through(self) -> None:
        assert agent_term.encode_key("hello world") == b"hello world"

    def test_a_word_starting_with_c_dash_is_not_a_control_key(self) -> None:
        # Only the exact 3-character C-<letter> form is a chord; anything
        # longer is literal text a user meant to type.
        assert agent_term.encode_key("C-long") == b"C-long"


class TestChildEnvironment:
    """The allowlist is a security boundary, so it gets direct tests.

    The previous implementation used a denylist and shipped with gaps that
    review caught -- connection URLs carrying passwords, KUBECONFIG, and
    *PASSPHRASE* names all reached the child. An allowlist cannot develop that
    class of gap, and these tests pin it.
    """

    def test_allowlisted_names_pass(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HOME", "/home/example")
        monkeypatch.setenv("PATH", "/usr/bin")
        env = agent_term.child_environment()
        assert env["HOME"] == "/home/example"
        assert env["PATH"] == "/usr/bin"

    @pytest.mark.parametrize(
        "name",
        [
            "CLAUDE_CODE_MESSAGING_TOKEN",
            "ANTHROPIC_API_KEY",
            "SSH_AUTH_SOCK",
            "GITHUB_TOKEN",
            "DATABASE_URL",
            "MY_DB_URL",
            "KUBECONFIG",
            "SOME_PASSPHRASE",
            "PRIVATE_KEY_PATH",
            "AWS_SECRET_ACCESS_KEY",
        ],
    )
    def test_secrets_are_excluded(
        self, monkeypatch: pytest.MonkeyPatch, name: str
    ) -> None:
        monkeypatch.setenv(name, "secret-value")
        assert name not in agent_term.child_environment()

    def test_term_is_always_set(self) -> None:
        assert agent_term.child_environment()["TERM"] == "xterm-256color"

    def test_lc_prefix_is_allowed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("LC_CTYPE", "C.UTF-8")
        assert agent_term.child_environment()["LC_CTYPE"] == "C.UTF-8"

    def test_opt_in_passthrough(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("NODE_ENV", "test")
        assert "NODE_ENV" not in agent_term.child_environment()
        assert agent_term.child_environment(["NODE_ENV"])["NODE_ENV"] == "test"


class TestSplitOnSeparator:
    """Regression for the argparse.REMAINDER bug.

    REMAINDER began capturing at the first token after the preceding
    positional, so `start edit --size 60x10 -- vim` swallowed --size into the
    command and the session silently came up at the default size.
    """

    def test_splits_at_first_separator(self) -> None:
        head, tail = agent_term.split_on_separator(
            ["start", "edit", "--size", "60x10", "--", "vim", "-u", "NONE"]
        )
        assert head == ["start", "edit", "--size", "60x10"]
        assert tail == ["vim", "-u", "NONE"]

    def test_no_separator(self) -> None:
        head, tail = agent_term.split_on_separator(["list"])
        assert head == ["list"]
        assert tail == []

    def test_a_later_double_dash_stays_in_the_command(self) -> None:
        _head, tail = agent_term.split_on_separator(["keys", "s", "--", "git", "--"])
        assert tail == ["git", "--"]

    def test_options_before_separator_are_still_parsed(self) -> None:
        args = agent_term.build_parser().parse_args(
            ["start", "edit", "--size", "60x10"]
        )
        assert args.size == (60, 10)


class TestValidation:
    @pytest.mark.parametrize("name", ["ok", "with-dash", "with_underscore", "abc123"])
    def test_accepts_safe_names(self, name: str) -> None:
        assert agent_term.valid_name(name) == name

    @pytest.mark.parametrize("name", ["", "has space", "has/slash", "dot.dot", "a:b"])
    def test_rejects_unsafe_names(self, name: str) -> None:
        with pytest.raises(SystemExit):
            agent_term.valid_name(name)

    def test_size_bounds(self) -> None:
        assert agent_term.parse_size("120x40") == (120, 40)
        for bad in ["0x0", "99999x99999", "nonsense", "10x10"]:
            with pytest.raises(argparse.ArgumentTypeError):
                agent_term.parse_size(bad)

    def test_socket_path_length_is_guarded(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        # A unix socket path is capped near 104 bytes, and macOS $TMPDIR eats
        # most of that budget. Fail with an explanation rather than a bare
        # "AF_UNIX path too long" from the connect().
        deep = tmp_path / ("d" * 80) / ("e" * 80)
        deep.mkdir(parents=True)
        monkeypatch.setenv("AGENT_TERM_STATE", str(deep))
        with pytest.raises(SystemExit, match="too long"):
            agent_term.socket_path("session")


class TestTolerantScreen:
    def test_private_sgr_does_not_raise(self) -> None:
        # pyte raises on CSI ? ... m, which vim emits on startup. A real
        # terminal ignores what it doesn't understand; crashing the session
        # over a colour hint is not acceptable.
        screen = agent_term.TolerantScreen(20, 5)
        stream = agent_term.pyte.ByteStream(screen)
        stream.feed(b"\x1b[?4m")
        stream.feed(b"hello")
        assert "hello" in screen.display[0]


# --------------------------------------------------------- integration tests


@pytest.fixture()
def short_state(tmp_path: Path) -> Iterator[str]:
    """An isolated state dir with a SHORT path.

    pytest's tmp_path lives under /private/var/folders/... on macOS, which is
    already ~90 bytes before a socket name is appended — past the ~104-byte
    unix socket limit. Using it here made every integration test fail on the
    length guard, which was the guard doing its job.
    """
    import shutil
    import tempfile

    path = tempfile.mkdtemp(prefix="/tmp/at-t")
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


@pytest.fixture()
def term(short_state: str) -> Iterator[Runner]:
    """A CLI runner bound to an isolated state directory."""
    env = dict(os.environ, AGENT_TERM_STATE=short_state)

    def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
            check=False,
        )
        if check and result.returncode != 0:
            raise AssertionError(
                f"{args} failed ({result.returncode})\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )
        return result

    yield run
    run("stop-all", check=False)


def wait_for(run: Runner, name: str, needle: str, timeout: float = 10.0) -> str:
    deadline = time.time() + timeout
    screen = ""
    while time.time() < deadline:
        result = run("read", name, "--raw", check=False)
        screen = str(result.stdout)
        if needle in screen:
            return screen
        time.sleep(0.2)
    raise AssertionError(f"never saw {needle!r}; last screen:\n{screen}")


class TestLifecycle:
    def test_start_read_keys_stop(self, term: Runner) -> None:
        term("start", "s1", "--", "cat")
        term("keys", "s1", "--", "hello-from-agent", "Enter")
        assert "hello-from-agent" in wait_for(term, "s1", "hello-from-agent")
        term("stop", "s1")

    def test_session_survives_between_invocations(self, term: Runner) -> None:
        # The whole reason a daemon exists: each CLI call is its own process.
        term("start", "s2", "--", "cat")
        term("keys", "s2", "--", "first", "Enter")
        wait_for(term, "s2", "first")
        term("keys", "s2", "--", "second", "Enter")
        screen = wait_for(term, "s2", "second")
        assert "first" in screen and "second" in screen

    def test_duplicate_name_is_refused(self, term: Runner) -> None:
        term("start", "dup", "--", "cat")
        result = term("start", "dup", "--", "cat", check=False)
        assert result.returncode != 0
        assert "already exists" in result.stderr

    def test_list_reports_the_session(self, term: Runner) -> None:
        term("start", "listed", "--", "cat")
        assert "listed" in term("list").stdout

    def test_list_is_empty_after_stop_all(self, term: Runner) -> None:
        term("start", "gone", "--", "cat")
        term("stop-all")
        assert "no agent sessions" in term("list").stdout

    def test_read_on_unknown_session_fails_clearly(self, term: Runner) -> None:
        result = term("read", "nope", check=False)
        assert result.returncode != 0
        assert "no session" in result.stderr


class TestUntrustedFraming:
    def test_banner_carries_a_fresh_nonce(self, term: Runner) -> None:
        term("start", "fence", "--", "cat")
        first = term("read", "fence").stdout
        second = term("read", "fence").stdout
        assert "BEGIN UNTRUSTED TERMINAL OUTPUT" in first
        nonce_one = first.split("fence ")[1].split(" ")[0]
        nonce_two = second.split("fence ")[1].split(" ")[0]
        assert nonce_one != nonce_two, "a fixed fence is forgeable by pane content"

    def test_raw_suppresses_the_banner(self, term: Runner) -> None:
        term("start", "raw", "--", "cat")
        assert "UNTRUSTED" not in term("read", "raw", "--raw").stdout


class TestChildIsolation:
    def test_secrets_do_not_reach_the_child(self, short_state: str) -> None:
        env = dict(
            os.environ,
            AGENT_TERM_STATE=short_state,
            CLAUDE_CODE_MESSAGING_TOKEN="tok-secret",
            DATABASE_URL="postgres://u:pw@h/db",
        )

        def run(*args: str) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [sys.executable, str(SCRIPT), *args],
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
                check=False,
            )

        try:
            run("start", "iso", "--", "bash", "--norc")
            run(
                "keys",
                "iso",
                "--",
                "echo TOK=${CLAUDE_CODE_MESSAGING_TOKEN:-absent} "
                "DB=${DATABASE_URL:-absent}",
                "Enter",
            )
            deadline = time.time() + 10
            screen = ""
            while time.time() < deadline:
                screen = run("read", "iso", "--raw").stdout
                if "TOK=" in screen and "\n" in screen:
                    break
                time.sleep(0.2)
            assert "tok-secret" not in screen
            assert "postgres://" not in screen
            assert "TOK=absent" in screen
            assert "DB=absent" in screen
        finally:
            run("stop-all")

    def test_child_env_has_no_socket_handle(self, short_state: str) -> None:
        """tmux hands every pane $TMUX. This must hand the child nothing."""
        env = dict(os.environ, AGENT_TERM_STATE=short_state)

        def run(*args: str) -> subprocess.CompletedProcess[str]:
            return subprocess.run(
                [sys.executable, str(SCRIPT), *args],
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
                check=False,
            )

        try:
            run("start", "handle", "--", "bash", "--norc")
            run(
                "keys", "handle", "--", "env | grep -ci sock; echo MARKER-DONE", "Enter"
            )
            deadline = time.time() + 10
            screen = ""
            while time.time() < deadline:
                screen = run("read", "handle", "--raw").stdout
                if "MARKER-DONE" in screen:
                    break
                time.sleep(0.2)
            assert short_state not in screen, "the socket path reached the child"
        finally:
            run("stop-all")
