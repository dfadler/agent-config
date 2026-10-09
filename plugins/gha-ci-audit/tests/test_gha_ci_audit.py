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
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Helpers: load a script as a module by path
# ---------------------------------------------------------------------------

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


def _load(name: str) -> types.ModuleType:
    path = SCRIPTS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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
