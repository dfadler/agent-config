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
# merge_timing.py
# ---------------------------------------------------------------------------


class TestMergeTiming:
    def setup_method(self) -> None:
        self.mod = _load("merge_timing")

    def _run_main(self, outputs_dir: Path) -> None:
        """Invoke the script's main() with sys.argv patched."""
        with patch.object(sys, "argv", ["merge_timing.py", str(outputs_dir)]):
            self.mod.main()

    def test_both_files(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        eval_root = tmp_path  # one level up from outputs_dir

        collect = {
            "duration_seconds": 30,
            "start_iso": "2025-01-01T10:00:00Z",
            "end_iso": "2025-01-01T10:00:30Z",
        }
        render = {
            "duration_seconds": 20,
            "start_iso": "2025-01-01T10:01:00Z",
            "end_iso": "2025-01-01T10:01:20Z",
        }
        (outputs_dir / "collect_timing.json").write_text(json.dumps(collect))
        (outputs_dir / "render_timing.json").write_text(json.dumps(render))

        self._run_main(outputs_dir)

        timing = json.loads((eval_root / "timing.json").read_text())
        assert timing["collect_duration_seconds"] == 30
        assert timing["render_duration_seconds"] == 20
        assert timing["total_duration_seconds"] == 50
        assert timing["collect_start_iso"] == "2025-01-01T10:00:00Z"

    def test_collect_only(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        collect = {
            "duration_seconds": 45,
            "start_iso": "2025-01-01T10:00:00Z",
            "end_iso": "2025-01-01T10:00:45Z",
        }
        (outputs_dir / "collect_timing.json").write_text(json.dumps(collect))

        self._run_main(outputs_dir)

        timing = json.loads((tmp_path / "timing.json").read_text())
        assert timing["collect_duration_seconds"] == 45
        assert timing["render_duration_seconds"] is None
        assert timing["total_duration_seconds"] == 45

    def test_no_files_exits_1(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with pytest.raises(SystemExit) as exc:
            self._run_main(outputs_dir)
        assert exc.value.code == 1


# ---------------------------------------------------------------------------
# detect_primary_workflow.py
# ---------------------------------------------------------------------------


class TestDetectPrimaryWorkflow:
    def setup_method(self) -> None:
        self.mod = _load("detect_primary_workflow")

    def _write_workflows(self, tmp_path: Path, workflows: list[dict[str, Any]]) -> Path:
        p = tmp_path / "workflows.json"
        p.write_text(json.dumps(workflows))
        return p

    def test_single_primary_detected(self, tmp_path: Path) -> None:
        workflows = [
            {"id": 1, "name": "CI"},
            {"id": 2, "name": "Deploy"},
        ]
        wf_path = self._write_workflows(tmp_path, workflows)
        candidates_path = tmp_path / "candidates.json"

        # get_workflow_events: CI has push, Deploy has schedule only
        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"push"} if wf_id == 1 else {"schedule"}

        with (
            patch.object(self.mod, "get_workflow_events", side_effect=fake_events),
            patch.object(
                sys,
                "argv",
                ["detect.py", str(wf_path), "owner/repo", str(candidates_path)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()

        assert exc.value.code == 0
        id_file = tmp_path / "primary_workflow_id.txt"
        assert id_file.exists()
        assert id_file.read_text().strip() == "1"

    def test_ambiguous_exits_2(self, tmp_path: Path) -> None:
        workflows = [{"id": 1, "name": "CI"}, {"id": 2, "name": "Build"}]
        wf_path = self._write_workflows(tmp_path, workflows)
        candidates_path = tmp_path / "candidates.json"

        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"push"}

        with (
            patch.object(self.mod, "get_workflow_events", side_effect=fake_events),
            patch.object(
                sys,
                "argv",
                ["detect.py", str(wf_path), "owner/repo", str(candidates_path)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()

        assert exc.value.code == 2
        assert candidates_path.exists()
        assert json.loads(candidates_path.read_text()) == workflows

    def test_no_match_defaults_to_first(self, tmp_path: Path) -> None:
        workflows = [{"id": 99, "name": "OnlySchedule"}]
        wf_path = self._write_workflows(tmp_path, workflows)
        candidates_path = tmp_path / "candidates.json"

        def fake_events(repo: str, wf_id: int) -> set[str]:
            return {"schedule"}

        with (
            patch.object(self.mod, "get_workflow_events", side_effect=fake_events),
            patch.object(
                sys,
                "argv",
                ["detect.py", str(wf_path), "owner/repo", str(candidates_path)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()

        assert exc.value.code == 0
        assert (tmp_path / "primary_workflow_id.txt").read_text().strip() == "99"

    def test_empty_workflows_exits_1(self, tmp_path: Path) -> None:
        wf_path = self._write_workflows(tmp_path, [])
        candidates_path = tmp_path / "candidates.json"

        def fake_events(repo: str, wf_id: int) -> set[str]:
            return set()

        with (
            patch.object(self.mod, "get_workflow_events", side_effect=fake_events),
            patch.object(
                sys,
                "argv",
                ["detect.py", str(wf_path), "owner/repo", str(candidates_path)],
            ),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()

        assert exc.value.code == 1

    def test_get_workflow_events_mocks_subprocess(self) -> None:
        mock_result = MagicMock()
        mock_result.stdout = '["push","pull_request"]'
        with patch("subprocess.run", return_value=mock_result):
            events = self.mod.get_workflow_events("owner/repo", 123)
        assert "push" in events
        assert "pull_request" in events


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
# find_p50_run.py
# ---------------------------------------------------------------------------


class TestFindP50Run:
    def setup_method(self) -> None:
        self.mod = _load("find_p50_run")

    def test_picks_closest_to_median(
        self, tmp_path: Path, capsys: pytest.CaptureFixture[str]
    ) -> None:
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
        f = tmp_path / "runs.json"
        f.write_text(json.dumps(runs))
        with patch.object(sys, "argv", ["find_p50_run.py", str(f)]):
            self.mod.main()
        out = capsys.readouterr().out.strip()
        # median is 4 min → run id 2
        assert "2" in out

    def test_no_successful_runs_exits_1(self, tmp_path: Path) -> None:
        runs = [{"id": 1, "conclusion": "failure"}]
        f = tmp_path / "runs.json"
        f.write_text(json.dumps(runs))
        with (
            patch.object(sys, "argv", ["find_p50_run.py", str(f)]),
            pytest.raises(SystemExit) as exc,
        ):
            self.mod.main()
        assert exc.value.code == 1


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
# write_collect_summary.py
# ---------------------------------------------------------------------------


class TestWriteCollectSummary:
    def setup_method(self) -> None:
        self.mod = _load("write_collect_summary")

    def test_writes_file(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with patch.object(
            sys,
            "argv",
            [
                "write_collect_summary.py",
                "--outputs-dir",
                str(outputs_dir),
                "--repo",
                "vitejs/vite",
                "--workflow-id",
                "12345",
                "--workflow-name",
                "CI",
                "--p50-run-id",
                "99999",
                "--p50-duration-min",
                "4.5",
                "--run-count",
                "100",
            ],
        ):
            self.mod.main()

        data = json.loads((outputs_dir / "collect_summary.json").read_text())
        assert data["repo"] == "vitejs/vite"
        assert data["primary_workflow_id"] == 12345
        assert data["p50_run_id"] == 99999
        assert data["p50_duration_min"] == pytest.approx(4.5)
        assert "collected_at" in data


# ---------------------------------------------------------------------------
# write_collect_timing.py
# ---------------------------------------------------------------------------


class TestWriteCollectTiming:
    def setup_method(self) -> None:
        self.mod = _load("write_collect_timing")

    def test_writes_file(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with patch.object(
            sys,
            "argv",
            [
                "write_collect_timing.py",
                str(outputs_dir),
                "120",
                "2025-01-01T10:00:00Z",
                "2025-01-01T10:02:00Z",
            ],
        ):
            self.mod.main()

        data = json.loads((outputs_dir / "collect_timing.json").read_text())
        assert data["duration_seconds"] == 120
        assert data["start_iso"] == "2025-01-01T10:00:00Z"
        assert data["end_iso"] == "2025-01-01T10:02:00Z"


# ---------------------------------------------------------------------------
# write_render_timing.py
# ---------------------------------------------------------------------------


class TestWriteRenderTiming:
    def setup_method(self) -> None:
        self.mod = _load("write_render_timing")

    def test_start_creates_marker(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with patch.object(
            sys, "argv", ["write_render_timing.py", "--start", str(outputs_dir)]
        ):
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

        with patch.object(
            sys, "argv", ["write_render_timing.py", "--end", str(outputs_dir)]
        ):
            self.mod.main()

        timing = json.loads((outputs_dir / "render_timing.json").read_text())
        assert timing["duration_seconds"] >= 10
        assert timing["start_iso"] == "2025-01-01T10:00:00Z"
        # marker should be removed
        assert not (outputs_dir / ".render_start").exists()

    def test_end_without_start_exits_0(self, tmp_path: Path) -> None:
        outputs_dir = tmp_path / "outputs"
        outputs_dir.mkdir()
        with (
            patch.object(
                sys, "argv", ["write_render_timing.py", "--end", str(outputs_dir)]
            ),
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
# analyze_jobs.py (unit-level functions only)
# ---------------------------------------------------------------------------


class TestAnalyzeJobs:
    def setup_method(self) -> None:
        self.mod = _load("analyze_jobs")

    def test_parse_dt_valid(self) -> None:
        dt = self.mod.parse_dt("2025-01-01T10:00:00Z")
        assert dt is not None
        assert dt.year == 2025

    def test_parse_dt_none(self) -> None:
        assert self.mod.parse_dt(None) is None
        assert self.mod.parse_dt("") is None

    def test_job_duration_min(self) -> None:
        job = {
            "started_at": "2025-01-01T10:00:00Z",
            "completed_at": "2025-01-01T10:03:00Z",
        }
        dur = self.mod.job_duration_min(job)
        assert dur == pytest.approx(3.0)

    def test_job_duration_min_missing(self) -> None:
        assert self.mod.job_duration_min({}) is None

    def test_classify_runner_github(self) -> None:
        assert self.mod.classify_runner("ubuntu-latest") == "github-hosted"
        assert self.mod.classify_runner("macos-14") == "github-hosted"

    def test_classify_runner_self_hosted(self) -> None:
        assert self.mod.classify_runner("runs-on--i-abc123") == "self-hosted"
        assert self.mod.classify_runner("self-hosted-runner") == "self-hosted"

    def test_classify_runner_unknown(self) -> None:
        assert self.mod.classify_runner("mystery-box") == "unknown"
        assert self.mod.classify_runner("") == "unknown"


# ---------------------------------------------------------------------------
# analyze_runs.py (unit-level functions only)
# ---------------------------------------------------------------------------


class TestAnalyzeRuns:
    def setup_method(self) -> None:
        self.mod = _load("analyze_runs")

    def test_parse_dt_valid(self) -> None:
        dt = self.mod.parse_dt("2025-06-01T08:00:00Z")
        assert dt is not None
        assert dt.month == 6

    def test_parse_dt_none(self) -> None:
        assert self.mod.parse_dt(None) is None

    def test_duration_min_api_shape(self) -> None:
        run = {
            "run_started_at": "2025-01-01T10:00:00Z",
            "updated_at": "2025-01-01T10:05:00Z",
        }
        dur = self.mod.duration_min(run)
        assert dur == pytest.approx(5.0)

    def test_duration_min_short_shape(self) -> None:
        run = {"s": "2025-01-01T10:00:00Z", "e": "2025-01-01T10:02:00Z"}
        dur = self.mod.duration_min(run)
        assert dur == pytest.approx(2.0)

    def test_duration_min_missing(self) -> None:
        assert self.mod.duration_min({}) is None


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
