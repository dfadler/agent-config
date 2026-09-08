"""Tests for the detached-terminal implementation.

The integration tests start real daemons holding real PTYs. They are hermetic
in the ways that matter: AGENT_TERM_STATE is redirected into a tmp directory so
nothing touches ~/.claude or a developer's live sessions, every session is torn
down in a fixture, and the programs driven are `cat` and `bash --norc` rather
than anything that reaches the network.
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import os
import re
import signal
import stat
import subprocess
import sys
import threading
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


class TestStateDir:
    """/tmp is world-writable, so the directory is verified, not assumed.

    Carried over from the review of the tmux implementation (#68), where the
    same check was missing: another user can create the default name first, or
    leave a symlink pointing somewhere they control, and makedirs(exist_ok=True)
    accepts either without complaint.
    """

    def test_rejects_a_symlink(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        real = tmp_path / "real"
        real.mkdir()
        link = tmp_path / "link"
        link.symlink_to(real)
        monkeypatch.setenv("AGENT_TERM_STATE", str(link))
        with pytest.raises(SystemExit, match="symlink"):
            agent_term.state_dir()

    def test_rejects_a_non_directory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        plain = tmp_path / "afile"
        plain.write_text("")
        monkeypatch.setenv("AGENT_TERM_STATE", str(plain))
        with pytest.raises(SystemExit):
            agent_term.state_dir()

    def test_accepts_and_tightens_our_own_directory(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        loose = tmp_path / "loose"
        loose.mkdir(mode=0o755)
        monkeypatch.setenv("AGENT_TERM_STATE", str(loose))
        assert agent_term.state_dir() == str(loose)
        assert stat.S_IMODE(os.stat(loose).st_mode) == 0o700


class TestHistoryRendering:
    """Scrollback must render in COLUMN order.

    pyte stores a history row as a sparse column -> Char mapping. Joining
    `sorted(row.values())` sorts the Char objects themselves, so
    "zebra 0 apple" came back as "  0aabeelpprz" — alphabetised, gaps dropped.
    `read --history` was returning scrambled text and nothing caught it,
    because no test looked at history CONTENT.
    """

    @staticmethod
    def _session_with_history(cols: int = 20, rows: int = 3) -> Any:
        """A Session with a screen but no PTY.

        Declared attributes rather than a bare namespace: mypy --strict rejects
        assigning to an attribute a class never declares. Only the rendering
        path is exercised, so nothing forks.
        """

        class ScreenOnlySession:
            cols: int
            screen: Any
            stream: Any

            render = agent_term.Session.render
            _history_row = agent_term.Session._history_row

        stub = ScreenOnlySession()
        stub.cols = cols
        stub.screen = agent_term.TolerantScreen(cols, rows, history=50)
        stub.stream = agent_term.pyte.ByteStream(stub.screen)
        return stub

    def test_history_preserves_character_order(self) -> None:
        stub = self._session_with_history()
        for i in range(8):
            stub.stream.feed(f"zebra {i} apple\r\n".encode())
        first = stub.render(history=True).splitlines()[0]
        assert first == "zebra 0 apple", f"history scrambled: {first!r}"

    def test_history_preserves_internal_spaces(self) -> None:
        stub = self._session_with_history()
        for i in range(8):
            stub.stream.feed(f"a  b {i}\r\n".encode())
        assert stub.render(history=True).splitlines()[0] == "a  b 0"

    def test_history_is_not_alphabetised(self) -> None:
        # The specific failure mode: a value sort produces sorted characters.
        stub = self._session_with_history()
        for i in range(8):
            stub.stream.feed(f"cba{i}\r\n".encode())
        first = stub.render(history=True).splitlines()[0]
        assert first == "cba0"
        assert first != "".join(sorted(first))

    def test_without_history_flag_only_the_visible_screen_is_returned(self) -> None:
        # `read` without `--history` must never reach into scrollback: that
        # flag is the documented boundary between the visible screen and
        # retained output crossing into an agent's context (SKILL.md, "Only
        # `--history` widens what you capture"). rows=3 here, so once more
        # than 3 lines have been fed, the earliest ones exist only in
        # `screen.history` -- render(history=False) must not surface them,
        # no matter what `lines` is asked for.
        stub = self._session_with_history(cols=20, rows=3)
        for i in range(8):
            stub.stream.feed(f"line-{i}\r\n".encode())
        visible = stub.render(lines=20, history=False)
        assert "line-0" not in visible, (
            f"scrollback leaked without --history: {visible!r}"
        )
        assert "line-7" in visible

    def test_history_flag_includes_the_scrolled_off_lines(self) -> None:
        stub = self._session_with_history(cols=20, rows=3)
        for i in range(8):
            stub.stream.feed(f"line-{i}\r\n".encode())
        with_history = stub.render(lines=20, history=True)
        assert "line-0" in with_history
        assert "line-7" in with_history


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


class TestSendWriteTimeout:
    """`send` must give up on a child that never reads, not park the daemon.

    Driven against the method directly rather than through the CLI, for a
    measured reason: on macOS a PTY master silently DISCARDS input once the
    line discipline's queue is full. Two megabytes went into one with no
    reader, without a single EAGAIN, and select() called the master writable
    throughout -- so no program under a real PTY can wedge the write on that
    platform, and a test going through `keys` could never reach this branch at
    all. A pipe nobody reads is the platform-independent form of the one
    condition the branch cares about: an fd select() never calls writable.

    What that leaves unproven is only that a PTY master can reach that state,
    which it does on Linux, where the master write returns EAGAIN once the line
    discipline's buffer fills.
    """

    class _StubSession:
        """Only what send() touches: an fd to write to, and the idle clock."""

        def __init__(self, fd: int) -> None:
            self.fd = fd
            self.last_activity = 0.0

    @staticmethod
    def _wedged_pipe() -> tuple[int, int]:
        """A pipe filled to capacity: its write end is never writable again."""
        read_fd, write_fd = os.pipe()
        os.set_blocking(write_fd, False)
        written = 0
        while written < 8 << 20:
            try:
                written += os.write(write_fd, b"\0" * 4096)
            except BlockingIOError:
                return read_fd, write_fd
        raise AssertionError("pipe never filled; it cannot wedge the write")

    @staticmethod
    def _send_in_thread(session: Any, keys: list[str]) -> Exception | None:
        """Call Session.send off the main thread, so a hang is a failure.

        A missing deadline does not raise -- it loops forever, and nothing in
        the suite would interrupt that. So the call gets its own thread and the
        first assertion is on the thread finishing at all.
        """
        box: dict[str, Exception | None] = {}

        def target() -> None:
            try:
                agent_term.Session.send(session, keys)
            except Exception as exc:
                box["exc"] = exc
            else:
                box["exc"] = None

        thread = threading.Thread(target=target, daemon=True)
        thread.start()
        thread.join(10.0)
        assert not thread.is_alive(), (
            "send() never returned: without the deadline it parks the one "
            "daemon loop, and every later read on the session times out"
        )
        return box["exc"]

    def test_gives_up_when_the_fd_never_accepts_input(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        read_fd, write_fd = self._wedged_pipe()
        try:
            monkeypatch.setattr(agent_term, "WRITE_TIMEOUT", 0.3)
            exc = self._send_in_thread(self._StubSession(write_fd), ["hi", "Enter"])
            assert isinstance(exc, RuntimeError), (
                f"expected a RuntimeError, got {exc!r}"
            )
            assert "not reading its input" in str(exc)
        finally:
            os.close(read_fd)
            os.close(write_fd)

    def test_reports_only_the_bytes_still_unwritten(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The short-write loop must advance before the deadline is reported.

        Ignoring the count os.write returns was the original bug: a payload
        larger than the buffer was silently truncated. Draining part of the
        pipe leaves room for exactly one partial write, so the numbers in the
        timeout message tell a loop that advanced from one that did not.
        """
        read_fd, write_fd = self._wedged_pipe()
        try:
            os.read(read_fd, 4096)  # room for one short write, then wedged again
            monkeypatch.setattr(agent_term, "WRITE_TIMEOUT", 0.3)
            payload = "z" * (64 << 10)
            exc = self._send_in_thread(self._StubSession(write_fd), [payload])
            assert isinstance(exc, RuntimeError), (
                f"expected a RuntimeError, got {exc!r}"
            )
            match = re.search(r"writing (\d+) of (\d+) bytes", str(exc))
            assert match, f"no byte counts in {exc!r}"
            remaining, total = int(match.group(1)), int(match.group(2))
            assert total == len(payload)
            assert 0 < remaining < total, (
                f"partial write not accounted for ({remaining} of {total})"
            )
        finally:
            os.close(read_fd)
            os.close(write_fd)


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


def _pid_alive(pid: int) -> bool:
    """True while the process exists. Signal 0 checks without delivering."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # exists, owned by someone else
    return True


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


class TestHistoryGating:
    """`read` without `--history` must not leak scrollback.

    End-to-end version of TestHistoryRendering's unit tests, driven through
    the actual CLI and socket protocol rather than calling Session.render()
    directly -- proving the gate holds across the whole `read` path, not just
    in the rendering helper.
    """

    def test_lines_without_history_excludes_scrolled_off_content(
        self, term: Runner
    ) -> None:
        # The smallest height the CLI allows (--size enforces rows >= 5).
        # `cat` echoes each typed line twice (tty echo, then cat's own
        # output), so 12 input lines comfortably push the earliest ones off
        # a 5-row screen and into scrollback.
        term("start", "hg1", "--size", "20x5", "--history", "50", "--", "cat")
        for i in range(12):
            term("keys", "hg1", "--", f"line-{i}", "Enter")
        wait_for(term, "hg1", "line-11")

        result = term("read", "hg1", "--raw", "--lines", "20")
        assert "line-11" in result.stdout
        assert "line-0" not in result.stdout, (
            f"read without --history leaked scrollback: {result.stdout!r}"
        )

    def test_history_flag_includes_scrolled_off_content(self, term: Runner) -> None:
        term("start", "hg2", "--size", "20x5", "--history", "50", "--", "cat")
        for i in range(12):
            term("keys", "hg2", "--", f"line-{i}", "Enter")
        wait_for(term, "hg2", "line-11")

        result = term("read", "hg2", "--raw", "--history", "--lines", "50")
        assert "line-0" in result.stdout
        assert "line-11" in result.stdout


class TestProcessGroupCleanup:
    def test_descendants_are_killed_with_the_session(self, term: Runner) -> None:
        """stop must not leave grandchildren running.

        pty.fork makes the child a process-group leader, so its own children
        share that group; signalling only the direct pid left them behind.

        Two fixture details, both learned the hard way:

        The descendant is `nohup`ed. The obvious fixture --
        `sh -c 'sleep 600 & wait'` -- does NOT distinguish the two
        implementations: closing the PTY master sends SIGHUP to the foreground
        process group, so that descendant dies either way. Measured, after the
        first version of this test passed against `os.kill` and proved nothing.
        A nohup'd child ignores the SIGHUP, so only killpg reaches it.

        And it is tracked by PID, not by matching `sleep 600` in a process
        list: any other process on the machine with that command line -- a
        second copy of this suite, a developer's own shell -- would satisfy the
        check, keep the poll spinning, or get killed by the cleanup.
        """
        marker = f"agentterm-pg-{os.getpid()}"
        term(
            "start",
            "pg",
            "--",
            "sh",
            "-c",
            f"nohup sleep 600 >/dev/null 2>&1 & echo {marker}-pid=$!; wait",
        )
        screen = wait_for(term, "pg", f"{marker}-pid=")

        # The child shell reports $! so the assertions target exactly the
        # process this test created.
        line = next(ln for ln in screen.splitlines() if f"{marker}-pid=" in ln)
        descendant = int(line.split(f"{marker}-pid=")[1].split()[0])

        assert _pid_alive(descendant), "fixture never started the descendant"

        term("stop", "pg")
        try:
            deadline = time.time() + 10
            while time.time() < deadline:
                if not _pid_alive(descendant):
                    return
                time.sleep(0.2)
            raise AssertionError(f"nohup'd descendant {descendant} survived stop")
        finally:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.kill(descendant, signal.SIGKILL)


class TestStartupOrdering:
    def test_read_immediately_after_start_succeeds(self, term: Runner) -> None:
        """No sleep between start and read.

        The daemon used to acknowledge startup before binding its socket, so a
        request issued straight after `start` could arrive first and fail with
        "no session" on a session that had started fine.
        """
        term("start", "race", "--", "cat")
        result = term("read", "race", "--raw", check=False)
        assert result.returncode == 0, f"read raced start: {result.stderr}"


class TestBindFailureCleanup:
    """A failed bind must take the already-forked child down with it.

    The child is forked before the socket is bound, so a bind failure that did
    not tear it down would leave the command running with nothing able to reach
    it -- an orphan, and another one on every retry.

    Two earlier fixtures (a nohup'd grandchild, then a shell running
    `trap '' HUP`) both passed with the cleanup DELETED, which is worse than no
    test at all. The reason was timing, not intent: the bind fails microseconds
    after the fork, before the child's shell has run a single line, so the
    child was still dying to the SIGHUP that follows the daemon closing the PTY
    master -- an unrelated mechanism producing the same visible teardown.

    The race is removed by making the child SIGHUP-immune from its first
    instruction instead of asking it to install a trap in time. SIG_IGN
    survives execve, so setting it on the CLI process propagates through both
    forks and the exec into the program itself. That is the same immunity a
    daemonising program gives itself, minus the window. The control arm asserts
    the immunity on the running platform rather than assuming it, so the
    failure arm cannot go quietly vacuous somewhere else.
    """

    #: `sh` writes its pid at once, waits, then leaves a marker. A child the
    #: cleanup kills never reaches the marker; a survivor always does.
    CHILD = "echo $$ > {pid}; sleep 0.5; : > {marker}; exec sleep 600"
    GRACE = 3.0  # generous next to the 0.5s the fixture waits

    @staticmethod
    def _ignore_sighup() -> None:
        """Runs between fork and exec; SIG_IGN then survives the exec."""
        signal.signal(signal.SIGHUP, signal.SIG_IGN)

    @staticmethod
    def _runner(short_state: str) -> Runner:
        """The `term` runner, plus the inherited SIGHUP disposition."""
        env = dict(os.environ, AGENT_TERM_STATE=short_state)

        def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
            result = subprocess.run(
                [sys.executable, str(SCRIPT), *args],
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
                check=False,
                preexec_fn=TestBindFailureCleanup._ignore_sighup,
            )
            if check and result.returncode != 0:
                raise AssertionError(
                    f"{args} failed ({result.returncode})\n"
                    f"stdout: {result.stdout}\nstderr: {result.stderr}"
                )
            return result

        return run

    @staticmethod
    def _wait_for_file(path: str, timeout: float) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if os.path.exists(path):
                return True
            time.sleep(0.1)
        return False

    @staticmethod
    def _read_pid(path: str, timeout: float) -> int | None:
        """The pid the child wrote, once the write has landed. None if never.

        `echo $$ > file` creates the file before it writes to it, so polling on
        existence alone can read it back empty on a loaded machine.
        """
        deadline = time.time() + timeout
        while True:
            with contextlib.suppress(OSError, ValueError):
                return int(Path(path).read_text().strip())
            if time.time() > deadline:
                return None
            time.sleep(0.1)

    def _assert_fixture_is_immune(self, run: Runner, state: str) -> None:
        """Control arm: the child really runs, and really ignores SIGHUP.

        Without this, a platform where SIG_IGN failed to propagate would leave
        the failure arm asserting that a child died -- which it would have done
        on its own, proving nothing about the cleanup.
        """
        pid_file = os.path.join(state, "control.pid")
        marker = os.path.join(state, "control.marker")
        run(
            "start",
            "control",
            "--",
            "sh",
            "-c",
            self.CHILD.format(pid=pid_file, marker=marker),
        )
        try:
            pid = self._read_pid(pid_file, 10.0)
            assert pid is not None, "the fixture child never ran"
            os.kill(pid, signal.SIGHUP)
            time.sleep(0.3)
            assert _pid_alive(pid), (
                f"fixture child {pid} died on SIGHUP; SIG_IGN did not survive "
                "into it, so the failure arm below would prove nothing"
            )
            assert self._wait_for_file(marker, 5.0), (
                "the fixture child never reached its marker"
            )
        finally:
            run("stop", "control", check=False)

    def test_a_failed_bind_does_not_leave_the_child_running(
        self, short_state: str
    ) -> None:
        run = self._runner(short_state)
        self._assert_fixture_is_immune(run, short_state)

        # Force the bind to fail AFTER the fork. The socket path is a symlink
        # into a directory that does not exist: os.path.exists() follows it and
        # reports nothing there, so cmd_start's own staleness check waves it
        # through, and only bind() -- past the fork -- trips over it.
        sock = os.path.join(short_state, "orphan.sock")
        os.symlink(os.path.join(short_state, "no-such-dir", "orphan.sock"), sock)
        assert not os.path.exists(sock), "the fixture must be invisible to cmd_start"

        pid_file = os.path.join(short_state, "orphan.pid")
        marker = os.path.join(short_state, "orphan.marker")
        result = run(
            "start",
            "orphan",
            "--",
            "sh",
            "-c",
            self.CHILD.format(pid=pid_file, marker=marker),
            check=False,
        )
        try:
            assert result.returncode != 0, "the bind was supposed to fail"
            assert "failed to start" in result.stderr, result.stderr
            assert not self._wait_for_file(marker, self.GRACE), (
                "the child outlived the failed start: an orphan running with "
                "no socket left to reach it"
            )
        finally:
            # By pid, never by matching a command line: `sleep 600` belongs to
            # plenty of processes that are not ours. getpgid fails first on a
            # pid that is already gone, so a recycled group is never signalled.
            orphan = self._read_pid(pid_file, 0.0)
            if orphan is not None:
                with contextlib.suppress(OSError):
                    os.killpg(os.getpgid(orphan), signal.SIGKILL)
                with contextlib.suppress(OSError):
                    os.kill(orphan, signal.SIGKILL)


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
            # The marker is split so the string we wait for CANNOT appear in
            # the echoed command line -- only in the shell's output. Without
            # this the loop matched the echo immediately and asserted against a
            # screen that had no result on it yet, so the security assertions
            # passed vacuously. CI caught it; macOS was fast enough to hide it.
            run(
                "keys",
                "iso",
                "--",
                'printf "%s\\n" "TO""K=${CLAUDE_CODE_MESSAGING_TOKEN:-absent} "'
                '"D""B=${DATABASE_URL:-absent}"',
                "Enter",
            )
            deadline = time.time() + 15
            screen = ""
            while time.time() < deadline:
                screen = run("read", "iso", "--raw").stdout
                if "TOK=" in screen:
                    break
                time.sleep(0.2)
            assert "TOK=" in screen, f"command never produced output:\n{screen}"
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
            # Sentinel split for the same reason as above: it must not be
            # matchable in the echoed command line, or the loop breaks before
            # `env` has produced anything and the assertion passes vacuously.
            run("keys", "handle", "--", 'env; printf "%s\\n" "DONE""-MARKER"', "Enter")
            deadline = time.time() + 15
            screen = ""
            while time.time() < deadline:
                screen = run("read", "handle", "--raw").stdout
                if "DONE-MARKER" in screen:
                    break
                time.sleep(0.2)
            assert "DONE-MARKER" in screen, f"env never ran:\n{screen}"
            assert short_state not in screen, "the socket path reached the child"
        finally:
            run("stop-all")


class TestSocketPreservation:
    """A probe failure is not proof the daemon is gone.

    Only a socket with nothing listening may be unlinked. A daemon that answers
    with an error, or is merely too slow to answer, is still holding a live
    session, and removing its socket would strand it with no way back in.
    """

    @staticmethod
    def _fake_daemon(path: str, reply: bytes | None) -> Callable[[], None]:
        """Serve one connection on `path`; send `reply`, or nothing at all."""
        import socket as _socket
        import threading

        server = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        server.bind(path)
        server.listen(1)

        def serve() -> None:
            with contextlib.suppress(OSError):
                conn, _ = server.accept()
                with conn:
                    conn.recv(4096)
                    if reply is None:
                        time.sleep(5)  # outlast the 2s probe timeout
                    else:
                        conn.sendall(reply)

        thread = threading.Thread(target=serve, daemon=True)
        thread.start()
        return server.close

    def test_error_reply_keeps_the_socket(self, term: Runner, short_state: str) -> None:
        path = os.path.join(short_state, "grumpy.sock")
        close = self._fake_daemon(path, b'{"ok": false, "error": "nope"}\n')
        try:
            result = term("list")
            assert os.path.exists(path), "a live daemon's socket was unlinked"
            assert "socket kept" in result.stdout
        finally:
            close()

    def test_slow_daemon_keeps_the_socket(self, term: Runner, short_state: str) -> None:
        path = os.path.join(short_state, "slow.sock")
        close = self._fake_daemon(path, None)
        try:
            result = term("list")
            assert os.path.exists(path), "a slow daemon's socket was unlinked"
            assert "socket kept" in result.stdout
        finally:
            close()

    def test_socket_with_no_listener_is_unlinked(
        self, term: Runner, short_state: str
    ) -> None:
        """The cleanup path still works: nothing listening means stale."""
        import socket as _socket

        path = os.path.join(short_state, "stale.sock")
        server = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
        server.bind(path)
        server.close()  # file remains, nothing accepts on it
        assert os.path.exists(path)
        term("list")
        assert not os.path.exists(path), "a stale socket was left behind"

    def test_eof_from_a_still_listening_daemon_keeps_the_socket(
        self, term: Runner, short_state: str
    ) -> None:
        """EOF alone does not prove absence.

        A daemon can accept, close that one connection without replying, and
        carry on serving. Classifying the EOF itself as "gone" unlinked a live
        daemon's socket; the listener re-probe is what tells them apart.
        """
        path = os.path.join(short_state, "eof.sock")
        close = self._fake_daemon(path, b"")  # accepts, replies nothing, stays up
        try:
            result = term("list")
            assert os.path.exists(path), (
                "a still-listening daemon's socket was unlinked"
            )
            assert "socket kept" in result.stdout
        finally:
            close()
