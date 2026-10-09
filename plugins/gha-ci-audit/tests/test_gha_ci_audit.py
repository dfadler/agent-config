"""Tests for the gha-ci-audit plugin Python scripts.

Each script is loaded via importlib so we can call its functions directly
without installing them as packages — the same technique the detached-terminal
tests use for agent_term.py.

All file I/O uses pytest's tmp_path fixture; no test touches the real
filesystem outside that tree.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers: load a script as a module by path
# ---------------------------------------------------------------------------

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"

# Several scripts do `from utils import ...` at module scope, expecting the
# same directory-relative resolution `python3 <script>.py` gets for free (the
# script's own directory is auto-added to sys.path[0]). Loading via
# importlib.util.spec_from_file_location below skips that, so it's done here
# once for the whole test module.
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

# collect_pipeline.py and timing.py are real, importable modules (that's the
# point of this refactor — see issue #368) rather than one-off CLIs that
# only work when run as `python3 <script>.py`, so they're imported normally
# instead of going through `_load()` below.
import collect_pipeline  # noqa: E402
import timing  # noqa: E402


def _load(name: str) -> types.ModuleType:
    path = SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# ---------------------------------------------------------------------------
# utils.py
# ---------------------------------------------------------------------------


class TestParseDt:
    def setup_method(self) -> None:
        self.mod = _load("utils")

    def test_none_returns_none(self) -> None:
        assert self.mod.parse_dt(None) is None

    def test_empty_string_returns_none(self) -> None:
        assert self.mod.parse_dt("") is None

    def test_utc_z_suffix(self) -> None:
        dt = self.mod.parse_dt("2025-01-01T10:00:00Z")
        assert dt is not None
        assert dt.year == 2025 and dt.hour == 10
        assert dt.utcoffset() is not None and dt.utcoffset().total_seconds() == 0

    def test_offset_suffix(self) -> None:
        dt = self.mod.parse_dt("2025-01-01T10:00:00+02:00")
        assert dt is not None
        assert dt.utcoffset() is not None and dt.utcoffset().total_seconds() == 7200


class TestDurationMinutes:
    def setup_method(self) -> None:
        self.mod = _load("utils")

    def test_timezone_aware_arithmetic(self) -> None:
        start = self.mod.parse_dt("2025-01-01T10:00:00Z")
        end = self.mod.parse_dt("2025-01-01T10:06:00Z")
        assert self.mod.duration_minutes(start, end) == pytest.approx(6.0)

    def test_cross_offset_arithmetic(self) -> None:
        # Same instant expressed in two offsets, plus 30 real minutes.
        start = self.mod.parse_dt("2025-01-01T10:00:00+02:00")
        end = self.mod.parse_dt("2025-01-01T08:30:00Z")
        assert self.mod.duration_minutes(start, end) == pytest.approx(30.0)

    def test_negative_when_reversed(self) -> None:
        start = self.mod.parse_dt("2025-01-01T10:06:00Z")
        end = self.mod.parse_dt("2025-01-01T10:00:00Z")
        assert self.mod.duration_minutes(start, end) == pytest.approx(-6.0)


class TestThirtyDaysAgo:
    def setup_method(self) -> None:
        self.mod = _load("utils")

    def test_format_is_parseable_and_in_the_past(self) -> None:
        result = self.mod.thirty_days_ago()
        parsed = self.mod.parse_dt(result)
        assert parsed is not None
        assert result.endswith("Z")
        assert parsed < self.mod.datetime.now(parsed.tzinfo)


class TestNullGuardUnified:
    """Regression coverage for the divergence #305 fixes: every caller now
    shares `parse_dt`'s guard, including `compute_workflow_timing.py`, which
    previously used a stripped local copy with no guard at all."""

    def test_compute_workflow_timing_skips_null_timestamp(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        import io

        mod = _load("compute_workflow_timing")
        runs = [
            {"s": None, "e": "2025-01-01T10:06:00Z"},  # missing start, skipped
            {"s": "2025-01-01T10:00:00Z", "e": "2025-01-01T10:04:00Z"},  # 4 min
        ]
        with patch.object(sys, "stdin", io.StringIO(json.dumps(runs))):
            mod.main()
        out = capsys.readouterr().out.strip()
        assert out == "4.0  4.0"


# ---------------------------------------------------------------------------
# aggregate.py
# ---------------------------------------------------------------------------


class TestStats:
    def setup_method(self) -> None:
        self.mod = _load("aggregate")

    def test_empty(self) -> None:
        result = self.mod.stats([])
        assert result == {"mean": 0.0, "stddev": 0.0, "min": 0.0, "max": 0.0}

    def test_single(self) -> None:
        result = self.mod.stats([5.0])
        assert result["mean"] == 5.0
        assert result["stddev"] == 0.0
        assert result["min"] == 5.0
        assert result["max"] == 5.0

    def test_multiple(self) -> None:
        result = self.mod.stats([1.0, 2.0, 3.0])
        assert result["mean"] == pytest.approx(2.0)
        assert result["min"] == 1.0
        assert result["max"] == 3.0
        assert result["stddev"] > 0


class TestLoadRun:
    def setup_method(self) -> None:
        self.mod = _load("aggregate")

    def test_missing_grading(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval1" / "with_skill"
        run_dir.mkdir(parents=True)
        assert self.mod.load_run(run_dir) is None

    def test_minimal_grading(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval1" / "with_skill"
        run_dir.mkdir(parents=True)
        grading = {
            "summary": {"pass_rate": 0.75, "passed": 3, "failed": 1, "total": 4},
            "execution_metrics": {"total_tool_calls": 10, "errors_encountered": 0},
        }
        (run_dir / "grading.json").write_text(json.dumps(grading))
        result = self.mod.load_run(run_dir)
        assert result is not None
        assert result["pass_rate"] == 0.75
        assert result["passed"] == 3
        assert result["total"] == 4
        assert result["configuration"] == "with_skill"

    def test_with_timing(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval1" / "with_skill"
        run_dir.mkdir(parents=True)
        grading = {"summary": {"pass_rate": 1.0, "passed": 2, "failed": 0, "total": 2}}
        (run_dir / "grading.json").write_text(json.dumps(grading))
        timing = {"total_duration_seconds": 120.0, "total_tokens": 5000}
        (run_dir / "timing.json").write_text(json.dumps(timing))
        result = self.mod.load_run(run_dir)
        assert result is not None
        assert result["time_seconds"] == 120.0
        assert result["tokens"] == 5000

    def test_with_metadata(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval1" / "with_skill"
        run_dir.mkdir(parents=True)
        (run_dir / "grading.json").write_text(json.dumps({"summary": {}}))
        meta = {"eval_id": 7, "eval_name": "vite-audit"}
        (run_dir / "eval_metadata.json").write_text(json.dumps(meta))
        result = self.mod.load_run(run_dir)
        assert result is not None
        assert result["eval_id"] == 7
        assert result["eval_name"] == "vite-audit"

    def test_bad_json_grading(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        run_dir = tmp_path / "eval1" / "with_skill"
        run_dir.mkdir(parents=True)
        (run_dir / "grading.json").write_text("not json{")
        result = self.mod.load_run(run_dir)
        assert result is None
        captured = capsys.readouterr()
        assert "Warning" in captured.err


class TestAggregate:
    def setup_method(self) -> None:
        self.mod = _load("aggregate")

    def _make_run(self, pass_rate: float = 0.8, time_s: float = 60.0) -> dict[str, Any]:
        return {
            "eval_id": 1,
            "eval_name": "test-eval",
            "configuration": "with_skill",
            "pass_rate": pass_rate,
            "time_seconds": time_s,
            "tokens": 1000,
            "tool_calls": 5,
            "errors": 0,
            "expectations": [],
            "notes": [],
        }

    def test_empty(self) -> None:
        result = self.mod.aggregate([])
        assert "with_skill" in result

    def test_single_run(self) -> None:
        runs = [self._make_run(0.5, 30.0)]
        result = self.mod.aggregate(runs)
        ws = result["with_skill"]
        assert ws["pass_rate"]["mean"] == 0.5
        assert ws["time_seconds"]["mean"] == 30.0

    def test_multiple_runs(self) -> None:
        runs = [self._make_run(0.6, 10.0), self._make_run(1.0, 20.0)]
        result = self.mod.aggregate(runs)
        ws = result["with_skill"]
        assert ws["pass_rate"]["mean"] == pytest.approx(0.8)


class TestGenerateBenchmark:
    def setup_method(self) -> None:
        self.mod = _load("aggregate")

    def _make_run(self) -> dict[str, Any]:
        return {
            "eval_id": 1,
            "eval_name": "vite-audit",
            "configuration": "with_skill",
            "pass_rate": 0.8,
            "passed": 4,
            "failed": 1,
            "total": 5,
            "time_seconds": 90.0,
            "tokens": 2000,
            "tool_calls": 8,
            "errors": 0,
            "expectations": [{"text": "report exists", "passed": True}],
            "notes": [],
        }

    def test_structure(self) -> None:
        runs = [self._make_run()]
        result = self.mod.generate_benchmark(
            runs, "gha-ci-audit", "skills/gha-ci-audit"
        )
        assert result["metadata"]["skill_name"] == "gha-ci-audit"
        assert len(result["runs"]) == 1
        assert result["runs"][0]["eval_name"] == "vite-audit"
        assert "run_summary" in result

    def test_markdown_output(self) -> None:
        runs = [self._make_run()]
        benchmark = self.mod.generate_benchmark(
            runs, "gha-ci-audit", "skills/gha-ci-audit"
        )
        md = self.mod.generate_markdown(benchmark)
        assert "# Benchmark" in md
        assert "Pass Rate" in md
        assert "vite-audit" in md

    def test_model_defaults_when_omitted(self) -> None:
        runs = [self._make_run()]
        result = self.mod.generate_benchmark(
            runs, "gha-ci-audit", "skills/gha-ci-audit"
        )
        assert result["metadata"]["executor_model"] == "claude-sonnet-4-6"
        assert result["metadata"]["analyzer_model"] == "claude-sonnet-4-6"

    def test_model_override_is_recorded(self) -> None:
        runs = [self._make_run()]
        result = self.mod.generate_benchmark(
            runs, "gha-ci-audit", "skills/gha-ci-audit", model="claude-opus-5-5"
        )
        assert result["metadata"]["executor_model"] == "claude-opus-5-5"
        assert result["metadata"]["analyzer_model"] == "claude-opus-5-5"

    def test_cli_model_flag_threads_through(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval-1" / "with_skill"
        run_dir.mkdir(parents=True)
        grading = {"summary": {"pass_rate": 1.0, "passed": 2, "failed": 0, "total": 2}}
        (run_dir / "grading.json").write_text(json.dumps(grading))

        argv = [
            "aggregate.py",
            str(tmp_path),
            "--model",
            "claude-opus-5-5",
        ]
        with patch("sys.argv", argv):
            self.mod.main()

        data = json.loads((tmp_path / "benchmark.json").read_text())
        assert data["metadata"]["executor_model"] == "claude-opus-5-5"
        assert data["metadata"]["analyzer_model"] == "claude-opus-5-5"


class TestAggregateEndToEnd:
    def setup_method(self) -> None:
        self.mod = _load("aggregate")

    def test_load_all_and_aggregate(self, tmp_path: Path) -> None:
        # Create two eval dirs
        for i in range(1, 3):
            run_dir = tmp_path / f"eval-{i}" / "with_skill"
            run_dir.mkdir(parents=True)
            grading = {
                "summary": {
                    "pass_rate": 0.5 * i,
                    "passed": i,
                    "failed": 2 - i,
                    "total": 2,
                },
                "execution_metrics": {"total_tool_calls": 4, "errors_encountered": 0},
            }
            (run_dir / "grading.json").write_text(json.dumps(grading))

        runs = self.mod.load_all(tmp_path)
        assert len(runs) == 2
        result = self.mod.aggregate(runs)
        assert result["with_skill"]["pass_rate"]["mean"] == pytest.approx(0.75)

    def test_writes_files(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "eval-1" / "with_skill"
        run_dir.mkdir(parents=True)
        grading = {"summary": {"pass_rate": 1.0, "passed": 2, "failed": 0, "total": 2}}
        (run_dir / "grading.json").write_text(json.dumps(grading))

        # Simulate main() logic
        runs = self.mod.load_all(tmp_path)
        benchmark = self.mod.generate_benchmark(
            runs, "gha-ci-audit", "skills/gha-ci-audit"
        )
        out_json = tmp_path / "benchmark.json"
        out_md = out_json.with_suffix(".md")
        out_json.write_text(json.dumps(benchmark, indent=2))
        out_md.write_text(self.mod.generate_markdown(benchmark))

        assert out_json.exists()
        assert out_md.exists()
        data = json.loads(out_json.read_text())
        assert data["metadata"]["skill_name"] == "gha-ci-audit"


# ---------------------------------------------------------------------------
# grade.py
# ---------------------------------------------------------------------------


class TestGradeCheckArtifactPublished:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_missing_report(self, tmp_path: Path) -> None:
        passed, evidence = self.mod.check_artifact_published(str(tmp_path))
        assert passed is False
        assert "not found" in evidence

    def test_too_small(self, tmp_path: Path) -> None:
        (tmp_path / "report.html").write_text("<html>tiny</html>")
        passed, evidence = self.mod.check_artifact_published(str(tmp_path))
        assert passed is False
        assert "bytes" in evidence

    def test_large_enough(self, tmp_path: Path) -> None:
        (tmp_path / "report.html").write_text("x" * 1001)
        passed, evidence = self.mod.check_artifact_published(str(tmp_path))
        assert passed is True


class TestGradeCheckWorkflowCountFound:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_workflows_json_sufficient(self, tmp_path: Path) -> None:
        workflows = [{"id": 1, "name": "CI"}, {"id": 2, "name": "Deploy"}]
        (tmp_path / "workflows.json").write_text(json.dumps(workflows))
        passed, evidence = self.mod.check_workflow_count_found(str(tmp_path))
        assert passed is True
        assert "2" in evidence

    def test_workflows_json_only_one(self, tmp_path: Path) -> None:
        (tmp_path / "workflows.json").write_text(json.dumps([{"id": 1, "name": "CI"}]))
        passed, evidence = self.mod.check_workflow_count_found(str(tmp_path))
        assert passed is False

    def test_fallback_to_report(self, tmp_path: Path) -> None:
        # No workflows.json; report.html has table rows
        html = (
            "<table>"
            "<tr><td>CI Workflow</td><td>push</td></tr>"
            "<tr><td>Deploy Workflow</td><td>push</td></tr>"
            "</table>"
        )
        (tmp_path / "report.html").write_text(html)
        passed, _ = self.mod.check_workflow_count_found(str(tmp_path))
        assert passed is True

    def test_no_files(self, tmp_path: Path) -> None:
        passed, _ = self.mod.check_workflow_count_found(str(tmp_path))
        assert passed is False


class TestGradeCheckFailureRate:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_no_report(self, tmp_path: Path) -> None:
        passed, _ = self.mod.check_failure_rate(str(tmp_path))
        assert passed is False

    def test_percent_near_failure(self, tmp_path: Path) -> None:
        html = "<p>Failure rate: 12.5%</p>"
        (tmp_path / "report.html").write_text(html)
        passed, evidence = self.mod.check_failure_rate(str(tmp_path))
        assert passed is True
        assert "12.5%" in evidence or "failure" in evidence.lower()

    def test_no_failure_rate(self, tmp_path: Path) -> None:
        html = "<p>All good, no failures here.</p>"
        (tmp_path / "report.html").write_text(html)
        passed, _ = self.mod.check_failure_rate(str(tmp_path))
        assert passed is False


class TestGradeCheckRankedOpportunities:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_sev_badges(self, tmp_path: Path) -> None:
        html = '<span class="sev-high">Slow tests</span><span class="sev-med">Cache miss</span>'
        (tmp_path / "report.html").write_text(html)
        passed, evidence = self.mod.check_ranked_opportunities(str(tmp_path))
        assert passed is True
        assert "sev-high" in evidence or "sev-med" in evidence

    def test_only_one_badge(self, tmp_path: Path) -> None:
        html = '<span class="sev-high">Slow tests</span>'
        (tmp_path / "report.html").write_text(html)
        passed, _ = self.mod.check_ranked_opportunities(str(tmp_path))
        assert passed is False

    def test_no_report(self, tmp_path: Path) -> None:
        passed, _ = self.mod.check_ranked_opportunities(str(tmp_path))
        assert passed is False


class TestGradeCheckDataFilesSaved:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_both_present(self, tmp_path: Path) -> None:
        (tmp_path / "runs.json").write_text("[{}]")
        (tmp_path / "jobs.json").write_text("[{}]")
        passed, evidence = self.mod.check_data_files_saved(str(tmp_path))
        assert passed is True
        assert "runs.json" in evidence

    def test_missing_jobs(self, tmp_path: Path) -> None:
        (tmp_path / "runs.json").write_text("[{}]")
        passed, evidence = self.mod.check_data_files_saved(str(tmp_path))
        assert passed is False
        assert "jobs.json" in evidence


class TestGradeAssertion:
    def setup_method(self) -> None:
        self.mod = _load("grade")

    def test_programmatic_passed(self, tmp_path: Path) -> None:
        (tmp_path / "report.html").write_text("x" * 1001)
        result = self.mod.grade_assertion(
            "artifact_published", "Report published", str(tmp_path)
        )
        assert result["text"] == "Report published"
        assert result["passed"] is True
        assert "evidence" in result

    def test_programmatic_failed(self, tmp_path: Path) -> None:
        result = self.mod.grade_assertion(
            "artifact_published", "Report published", str(tmp_path)
        )
        assert result["passed"] is False

    def test_ai_deferred(self, tmp_path: Path) -> None:
        result = self.mod.grade_assertion(
            "some_ai_assertion", "LLM-graded thing", str(tmp_path)
        )
        assert result["passed"] is None
        assert result["evidence"] == "requires_ai_grader"

    def test_fields_present(self, tmp_path: Path) -> None:
        result = self.mod.grade_assertion(
            "artifact_published", "Report published", str(tmp_path)
        )
        assert set(result.keys()) >= {"text", "passed", "evidence"}


# ---------------------------------------------------------------------------
# detect_primary_workflow.py
# ---------------------------------------------------------------------------


class TestDetectPrimaryWorkflow:
    """`detect_primary_workflow` is now a pure function on `collect_pipeline`
    (no file I/O, no `sys.exit`) — `collect()` decides what to do with a
    `PrimaryWorkflowResult` (write `workflow_candidates.json`, raise, etc.),
    and that behavior is covered separately in `TestCollect` below."""

    def test_single_primary_detected(self) -> None:
        workflows = [
            {"id": 1, "name": "CI"},
            {"id": 2, "name": "Deploy"},
        ]

        # get_workflow_events: CI has push, Deploy has schedule only
        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"push"} if wf_id == 1 else {"schedule"}

        with patch.object(
            collect_pipeline, "get_workflow_events", side_effect=fake_events
        ):
            result = collect_pipeline.detect_primary_workflow(workflows, "owner/repo")

        assert result.ambiguous is False
        assert result.workflow == {"id": 1, "name": "CI"}
        assert result.candidates == []

    def test_ambiguous(self) -> None:
        workflows = [{"id": 1, "name": "CI"}, {"id": 2, "name": "Build"}]

        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"push"}

        with patch.object(
            collect_pipeline, "get_workflow_events", side_effect=fake_events
        ):
            result = collect_pipeline.detect_primary_workflow(workflows, "owner/repo")

        assert result.ambiguous is True
        assert result.workflow is None
        assert result.candidates == workflows

    def test_no_match_defaults_to_first(self) -> None:
        workflows = [{"id": 99, "name": "OnlySchedule"}]

        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"schedule"}

        with patch.object(
            collect_pipeline, "get_workflow_events", side_effect=fake_events
        ):
            result = collect_pipeline.detect_primary_workflow(workflows, "owner/repo")

        assert result.ambiguous is False
        assert result.workflow == {"id": 99, "name": "OnlySchedule"}
        assert result.warning is not None and "defaulting to first" in result.warning

    def test_no_active_workflows(self) -> None:
        def fake_events(repo: str, wf_id: int) -> set[str]:
            return set()

        with patch.object(
            collect_pipeline, "get_workflow_events", side_effect=fake_events
        ):
            result = collect_pipeline.detect_primary_workflow([], "owner/repo")

        assert result.ambiguous is False
        assert result.workflow is None
        assert result.warning == "No active workflows found."

    def test_get_workflow_events_mocks_subprocess(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = '["push","pull_request"]'
        with patch("subprocess.run", return_value=mock_result):
            events = collect_pipeline.get_workflow_events("owner/repo", 123)
        assert "push" in events
        assert "pull_request" in events

    def test_get_workflow_events_swallows_errors(self) -> None:
        with patch("subprocess.run", side_effect=RuntimeError("boom")):
            events = collect_pipeline.get_workflow_events("owner/repo", 123)
        assert events == set()


# ---------------------------------------------------------------------------
# compute_workflow_timing.py
# ---------------------------------------------------------------------------


class TestComputeWorkflowTiming:
    def setup_method(self) -> None:
        self.mod = _load("compute_workflow_timing")

    def _run(
        self, data: list[dict[str, Any]], capsys: pytest.CaptureFixture[str]
    ) -> str:
        import io

        stdin_data = json.dumps(data)
        with patch.object(sys, "stdin", io.StringIO(stdin_data)):
            self.mod.main()
        return capsys.readouterr().out.strip()

    def test_valid_runs(self, capsys: pytest.CaptureFixture[str]) -> None:
        runs = [
            {"s": "2025-01-01T10:00:00Z", "e": "2025-01-01T10:06:00Z"},  # 6 min
            {"s": "2025-01-01T10:00:00Z", "e": "2025-01-01T10:04:00Z"},  # 4 min
        ]
        out = self._run(runs, capsys)
        # avg=5.0, p90=6.0
        assert "5.0" in out

    def test_empty_list(self, capsys: pytest.CaptureFixture[str]) -> None:
        out = self._run([], capsys)
        assert out == "?  ?"

    def test_bad_json(self, capsys: pytest.CaptureFixture[str]) -> None:
        import io

        with (
            patch.object(sys, "stdin", io.StringIO("not valid json")),
            pytest.raises(SystemExit),
        ):
            self.mod.main()
        out = capsys.readouterr().out.strip()
        assert out == "?  ?"


# ---------------------------------------------------------------------------
# check_failures.py
# ---------------------------------------------------------------------------


class TestCheckFailures:
    def setup_method(self) -> None:
        self.mod = _load("check_failures")

    def _make_runs(self, conclusions: list[str]) -> list[dict[str, Any]]:
        return [
            {"conclusion": c, "created_at": "2025-01-01T10:00:00Z"} for c in conclusions
        ]

    def test_no_chronic(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        runs = self._make_runs(["success", "success", "failure", "success"])
        f = tmp_path / "runs.json"
        f.write_text(json.dumps(runs))
        with (
            patch.object(sys, "argv", ["check_failures.py", str(f)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 0
        out = capsys.readouterr().out
        assert "chronic=no" in out

    def test_chronic_by_rate(self, tmp_path: Path) -> None:
        runs = self._make_runs(["failure"] * 5 + ["success"] * 2)
        f = tmp_path / "runs.json"
        f.write_text(json.dumps(runs))
        with (
            patch.object(sys, "argv", ["check_failures.py", str(f)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 1

    def test_chronic_by_streak(self, tmp_path: Path) -> None:
        runs = self._make_runs(["failure"] * 5)
        f = tmp_path / "runs.json"
        f.write_text(json.dumps(runs))
        with (
            patch.object(sys, "argv", ["check_failures.py", str(f)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 1

    def test_no_data(self, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
        f = tmp_path / "runs.json"
        f.write_text(json.dumps([]))
        with (
            patch.object(sys, "argv", ["check_failures.py", str(f)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 0
        assert "no_data" in capsys.readouterr().out

    def test_output_writes_json_when_chronic(self, tmp_path: Path) -> None:
        runs = self._make_runs(["failure"] * 5)
        runs_file = tmp_path / "runs.json"
        runs_file.write_text(json.dumps(runs))
        out_file = tmp_path / "failure_check.json"
        with (
            patch.object(
                sys,
                "argv",
                ["check_failures.py", str(runs_file), "--output", str(out_file)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 1
        data = json.loads(out_file.read_text())
        assert data["chronic"] is True
        assert data["failure_rate"] == 1.0
        assert "details" in data

    def test_output_writes_json_when_not_chronic(self, tmp_path: Path) -> None:
        runs = self._make_runs(["success", "success", "failure", "success"])
        runs_file = tmp_path / "runs.json"
        runs_file.write_text(json.dumps(runs))
        out_file = tmp_path / "failure_check.json"
        with (
            patch.object(
                sys,
                "argv",
                ["check_failures.py", str(runs_file), "--output", str(out_file)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 0
        data = json.loads(out_file.read_text())
        assert data == {
            "chronic": False,
            "failure_rate": 0.25,
            "details": data["details"],
        }
        assert isinstance(data["details"], str) and data["details"]

    def test_output_writes_json_when_no_data(self, tmp_path: Path) -> None:
        runs_file = tmp_path / "runs.json"
        runs_file.write_text(json.dumps([]))
        out_file = tmp_path / "failure_check.json"
        with (
            patch.object(
                sys,
                "argv",
                ["check_failures.py", str(runs_file), "--output", str(out_file)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 0
        data = json.loads(out_file.read_text())
        assert data == {"chronic": False, "failure_rate": 0.0, "details": "no_data"}


# ---------------------------------------------------------------------------
# collect_pipeline.py — find_p50_run / check_failures as plain functions
#
# The tests above exercise find_p50_run.py/check_failures.py's CLI surface
# (argv, stdout, exit codes) since those thin wrappers are still invoked
# directly by the interactive skill flow (see SKILL.md). These tests cover
# the underlying collect_pipeline functions themselves, which the old
# file-based CLI tests couldn't isolate from argv/exit-code plumbing.
# ---------------------------------------------------------------------------


class TestCollectPipelineFindP50Run:
    def test_picks_closest_to_median(self) -> None:
        runs = [
            {
                "id": 1,
                "conclusion": "success",
                "run_started_at": "2025-01-01T10:00:00Z",
                "updated_at": "2025-01-01T10:02:00Z",
                "created_at": "2025-01-01T10:00:00Z",
            },
            {
                "id": 2,
                "conclusion": "success",
                "run_started_at": "2025-01-01T10:00:00Z",
                "updated_at": "2025-01-01T10:04:00Z",
                "created_at": "2025-01-01T10:00:00Z",
            },
            {
                "id": 3,
                "conclusion": "success",
                "run_started_at": "2025-01-01T10:00:00Z",
                "updated_at": "2025-01-01T10:06:00Z",
                "created_at": "2025-01-01T10:00:00Z",
            },
        ]
        result = collect_pipeline.find_p50_run(runs)
        assert result is not None
        assert result.run_id == 2
        assert result.duration_min == pytest.approx(4.0)
        assert result.p50 == pytest.approx(4.0)
        assert result.n == 3

    def test_accepts_raw_gh_api_shape(self) -> None:
        payload = {
            "workflow_runs": [
                {
                    "id": 1,
                    "conclusion": "success",
                    "run_started_at": "2025-01-01T10:00:00Z",
                    "updated_at": "2025-01-01T10:02:00Z",
                }
            ]
        }
        result = collect_pipeline.find_p50_run(payload)
        assert result is not None
        assert result.run_id == 1

    def test_no_successful_runs_returns_none(self) -> None:
        assert (
            collect_pipeline.find_p50_run([{"id": 1, "conclusion": "failure"}]) is None
        )


class TestCollectPipelineCheckFailures:
    def _make_runs(self, conclusions: list[str]) -> list[dict[str, Any]]:
        return [
            {"conclusion": c, "created_at": "2025-01-01T10:00:00Z"} for c in conclusions
        ]

    def test_no_chronic(self) -> None:
        runs = self._make_runs(["success", "success", "failure", "success"])
        result = collect_pipeline.check_failures(runs)
        assert result.chronic is False
        assert result.failure_rate == pytest.approx(0.25)
        assert collect_pipeline.format_failure_report(result)[-1] == "chronic=no"

    def test_chronic_by_rate(self) -> None:
        runs = self._make_runs(["failure"] * 5 + ["success"] * 2)
        result = collect_pipeline.check_failures(runs)
        assert result.chronic is True

    def test_chronic_by_streak(self) -> None:
        runs = self._make_runs(["failure"] * 5)
        result = collect_pipeline.check_failures(runs)
        assert result.chronic is True
        assert result.streak == 5

    def test_no_data(self) -> None:
        result = collect_pipeline.check_failures([])
        assert result.chronic is False
        assert result.no_data is True
        assert collect_pipeline.format_failure_report(result) == ["no_data"]
        assert result.to_dict() == {
            "chronic": False,
            "failure_rate": 0.0,
            "details": "no_data",
        }


# ---------------------------------------------------------------------------
# collect_pipeline.py — build_collect_summary
#
# write_collect_summary.py was folded into collect_pipeline.py — it had no
# callers besides collect.sh itself (unlike find_p50_run.py/check_failures.py,
# which the interactive skill flow also invokes directly).
# ---------------------------------------------------------------------------


class TestBuildCollectSummary:
    def test_writes_expected_fields(self) -> None:
        summary = collect_pipeline.build_collect_summary(
            repo="vitejs/vite",
            workflow_id=12345,
            workflow_name="CI",
            p50_run_id=99999,
            p50_duration_min=4.5,
            run_count=100,
        )
        assert summary["repo"] == "vitejs/vite"
        assert summary["primary_workflow_id"] == 12345
        assert summary["p50_run_id"] == 99999
        assert summary["p50_duration_min"] == pytest.approx(4.5)
        assert "collected_at" in summary


# ---------------------------------------------------------------------------
# collect_pipeline.py — collect() orchestration
#
# collect.sh used to run 8 `gh api` calls and 5 python3 subprocess
# invocations wired together by files in $OUTPUT_DIR (see the bats coverage
# in scripts/tests/collect.bats for the shell-level contract). These tests
# cover the in-process orchestration function collect.sh now delegates to
# in a single call: `gh` access is mocked at the `run_gh_api`/
# `fetch_secondary_stats` seam so no network call happens, but everything
# downstream of that (detection, p50 selection, failure check, summary,
# timing, and the output files themselves) runs for real.
# ---------------------------------------------------------------------------


class TestCollect:
    @staticmethod
    def _fake_run_gh_api(args: list[str]) -> str:
        url = args[0]
        if url.endswith("/actions/workflows") and "--jq" in args:
            return json.dumps(
                [{"id": 12345, "name": "CI", "path": ".github/workflows/ci.yml"}]
            )
        if "/actions/runs/" in url and "/jobs" in url:
            return json.dumps({"jobs": []})
        if "per_page=100" in url:
            return json.dumps(
                {
                    "workflow_runs": [
                        {
                            "id": 99001,
                            "run_started_at": "2024-01-01T10:00:00Z",
                            "updated_at": "2024-01-01T10:10:00Z",
                            "conclusion": "success",
                            "created_at": "2024-01-01T10:00:00Z",
                        }
                    ]
                }
            )
        if "per_page=1" in url:
            return "42\n"
        raise AssertionError(f"unexpected gh api call: {args}")

    def test_happy_path_writes_all_output_files(self, tmp_path: Path) -> None:
        output_dir = tmp_path / "outputs"
        with (
            patch.object(
                collect_pipeline, "run_gh_api", side_effect=self._fake_run_gh_api
            ),
            patch.object(
                collect_pipeline,
                "fetch_secondary_stats",
                return_value="no secondary workflows\n",
            ),
        ):
            result = collect_pipeline.collect(
                repo="test/repo",
                output_dir=output_dir,
                workflow_id=12345,
                scripts_dir=tmp_path,
            )

        assert result.workflow_id == 12345
        assert result.workflow_name == "CI"
        assert result.p50_run_id == 99001
        assert result.run_count == 42

        for name in (
            "workflows.json",
            "run_count_primary.txt",
            "runs.json",
            "p50_run.txt",
            "jobs.json",
            "failure_check.json",
            "workflow_stats.txt",
            "collect_summary.json",
            "collect_timing.json",
        ):
            assert (output_dir / name).exists(), name

        assert (
            json.loads((output_dir / "collect_summary.json").read_text())["repo"]
            == "test/repo"
        )

    def test_ambiguous_raises_and_writes_candidates(self, tmp_path: Path) -> None:
        output_dir = tmp_path / "outputs"

        def fake_run_gh_api(args: list[str]) -> str:
            url = args[0]
            if url.endswith("/actions/workflows") and "--jq" in args:
                return json.dumps([{"id": 1, "name": "CI"}, {"id": 2, "name": "Build"}])
            raise AssertionError(f"unexpected gh api call: {args}")

        with (
            patch.object(collect_pipeline, "run_gh_api", side_effect=fake_run_gh_api),
            patch.object(
                collect_pipeline, "get_workflow_events", return_value={"push"}
            ),
            pytest.raises(collect_pipeline.AmbiguousPrimaryWorkflowError),
        ):
            collect_pipeline.collect(
                repo="test/repo",
                output_dir=output_dir,
                workflow_id=None,
                scripts_dir=tmp_path,
            )

        assert (output_dir / "workflow_candidates.json").exists()
        candidates = json.loads((output_dir / "workflow_candidates.json").read_text())
        assert candidates == [{"id": 1, "name": "CI"}, {"id": 2, "name": "Build"}]

    def test_no_active_workflows_raises_fatal(self, tmp_path: Path) -> None:
        output_dir = tmp_path / "outputs"
        with (
            patch.object(collect_pipeline, "run_gh_api", return_value="[]"),
            pytest.raises(collect_pipeline.CollectFatalError),
        ):
            collect_pipeline.collect(
                repo="test/repo",
                output_dir=output_dir,
                workflow_id=None,
                scripts_dir=tmp_path,
            )


# ---------------------------------------------------------------------------
# timing.py — shared start()/end() used by both the collect and render sides
#
# Replaces write_collect_timing.py and write_render_timing.py, which
# independently implemented the same {duration_seconds, start_iso, end_iso}
# shape. The pure functions are what the collect side now calls directly
# (see TestCollect below); the CLI (--start/--end <outputs_dir>) is still
# needed for the render side, which spans two separate agent turns and so
# needs the marker persisted to disk between them (see agents/renderer.md).
# ---------------------------------------------------------------------------


class TestTimingPure:
    def test_end_computes_duration(self) -> None:
        marker = timing.Marker(epoch=1000, iso="2025-01-01T10:00:00Z")
        with patch.object(
            timing,
            "start",
            return_value=timing.Marker(epoch=1120, iso="2025-01-01T10:02:00Z"),
        ):
            result = timing.end(marker)
        assert result.duration_seconds == 120
        assert result.start_iso == "2025-01-01T10:00:00Z"
        assert result.end_iso == "2025-01-01T10:02:00Z"
        assert result.to_dict() == {
            "duration_seconds": 120,
            "start_iso": "2025-01-01T10:00:00Z",
            "end_iso": "2025-01-01T10:02:00Z",
        }

    def test_marker_round_trips_through_dict(self) -> None:
        marker = timing.start()
        assert timing.Marker.from_dict(marker.to_dict()) == marker


class TestTimingCli:
    def setup_method(self) -> None:
        self.mod = timing

    def test_start_creates_marker(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with patch.object(sys, "argv", ["timing.py", "--start", str(outputs_dir)]):
            self.mod.main()
        marker = outputs_dir / ".render_start"
        assert marker.exists()
        data = json.loads(marker.read_text())
        assert "epoch" in data
        assert "iso" in data

    def test_end_writes_timing(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        # Write a marker first
        import time

        start_epoch = int(time.time()) - 10
        marker_data = {
            "epoch": start_epoch,
            "iso": "2025-01-01T10:00:00Z",
        }
        (outputs_dir / ".render_start").write_text(json.dumps(marker_data))

        with patch.object(sys, "argv", ["timing.py", "--end", str(outputs_dir)]):
            self.mod.main()

        timing_data = json.loads((outputs_dir / "render_timing.json").read_text())
        assert timing_data["duration_seconds"] >= 10
        assert timing_data["start_iso"] == "2025-01-01T10:00:00Z"
        # marker should be removed
        assert not (outputs_dir / ".render_start").exists()

    def test_end_without_start_exits_0(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with (
            patch.object(sys, "argv", ["timing.py", "--end", str(outputs_dir)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 0


# ---------------------------------------------------------------------------
# write_assertions.py
# ---------------------------------------------------------------------------


class TestWriteAssertions:
    def setup_method(self) -> None:
        self.mod = _load("write_assertions")

    def test_populates_assertions(self, tmp_path: Path) -> None:
        # Create iter_dir with a run dir
        iter_dir = tmp_path / "iteration-1"
        run_dir = iter_dir / "vite-audit" / "with_skill"
        run_dir.mkdir(parents=True)
        meta = {"eval_id": 1, "eval_name": "vite-audit"}
        (run_dir / "eval_metadata.json").write_text(json.dumps(meta))

        # Create evals.json
        evals_json = tmp_path / "evals.json"
        evals_data = {
            "evals": [
                {
                    "id": 1,
                    "dir_name": "vite-audit",
                    "assertions": [
                        {"id": "artifact_published", "text": "Report published"},
                    ],
                }
            ]
        }
        evals_json.write_text(json.dumps(evals_data))

        with patch.object(
            sys, "argv", ["write_assertions.py", str(iter_dir), str(evals_json)]
        ):
            self.mod.main()

        updated = json.loads((run_dir / "eval_metadata.json").read_text())
        assert len(updated["assertions"]) == 1
        assert updated["assertions"][0]["id"] == "artifact_published"

    def test_skips_eval_missing_dir_name(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
        iter_dir = tmp_path / "iteration-1"
        iter_dir.mkdir()

        evals_json = tmp_path / "evals.json"
        evals_json.write_text(json.dumps({"evals": [{"id": 1, "assertions": []}]}))

        with patch.object(
            sys, "argv", ["write_assertions.py", str(iter_dir), str(evals_json)]
        ):
            self.mod.main()

        assert "Missing dir_name" in capsys.readouterr().err


# ---------------------------------------------------------------------------
# check_status.py (unit-level check_run function)
# ---------------------------------------------------------------------------


class TestCheckStatus:
    def setup_method(self) -> None:
        self.mod = _load("check_status")

    def test_all_missing(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "with_skill"
        run_dir.mkdir()
        status = self.mod.check_run(run_dir)
        assert status["has_report"] is False
        assert status["has_grading"] is False
        assert status["complete"] is False

    def test_report_present(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "with_skill"
        outputs = run_dir / "outputs"
        outputs.mkdir(parents=True)
        (outputs / "report.html").write_text("<html/>")
        status = self.mod.check_run(run_dir)
        assert status["has_report"] is True
        assert status["has_grading"] is False
        assert status["complete"] is False

    def test_full_run(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "with_skill"
        outputs = run_dir / "outputs"
        outputs.mkdir(parents=True)
        (outputs / "report.html").write_text("<html/>")
        grading = {"summary": {"pass_rate": 0.9}}
        (run_dir / "grading.json").write_text(json.dumps(grading))
        (run_dir / "timing.json").write_text("{}")
        status = self.mod.check_run(run_dir)
        assert status["has_report"] is True
        assert status["has_grading"] is True
        assert status["complete"] is True
        assert status["pass_rate"] == pytest.approx(0.9)
