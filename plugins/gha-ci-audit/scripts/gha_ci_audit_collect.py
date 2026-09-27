#!/usr/bin/env python3
"""Run one gha-ci-audit collect iteration end-to-end (issue #368).

Concentrates what used to be collect.sh's file-IPC pipeline of one-off
scripts — detect_primary_workflow.py, write_collect_summary.py, and the
now-removed write_collect_timing.py, previously wired together only through
JSON/txt files in `$OUTPUT_DIR` because they ran as separate processes even
though they always run in the same collect invocation — into one importable
module with a single `collect(repo, output_dir)` entrypoint. `find_p50_run`
and `check_failures` remain separate files (they're also documented,
standalone CLI tools used outside the collect pipeline — see SKILL.md Steps
4-6), but their logic is exposed as plain functions and imported here
directly, so this module still calls them in-process rather than shelling
out and round-tripping the result through a file.

collect.sh is now a thin entrypoint that just execs this module.

Usage:
    python3 gha_ci_audit_collect.py --repo <owner/repo> --output-dir <path> \\
        [--workflow-id <id>]

Exit codes:
    0  Success — all output files written
    1  Fatal error (no active workflows, or no successful runs with duration
       data)
    2  Ambiguous primary workflow — workflow_candidates.json written; caller
       must re-invoke with --workflow-id <id> after AI disambiguation

Requires: gh, python3 (fetch_workflow_stats.sh, invoked for secondary
workflow stats, additionally requires jq).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import timing
from check_failures import compute_failure_check
from find_p50_run import find_p50
from utils import thirty_days_ago

SCRIPT_DIR = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Primary workflow detection (formerly detect_primary_workflow.py)
# ---------------------------------------------------------------------------


@dataclass
class DetectionResult:
    """Result of detect_primary_workflow().

    status is one of:
      "single"    — exactly one workflow matches push/pull_request; `workflow` is it
      "ambiguous" — more than one matches; `candidates` holds all of them
      "default"   — none matched; `workflow` defaults to the first active workflow
      "empty"     — `workflows` was empty; both `workflow` and `candidates` are unset
    """

    status: str
    workflow: dict[str, Any] | None = None
    candidates: list[dict[str, Any]] = field(default_factory=list)


def get_workflow_events(repo: str, workflow_id: int) -> set[str]:
    """Return the set of distinct event types seen in the last 10 runs."""
    try:
        result = subprocess.run(
            [
                "gh",
                "api",
                f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=10",
                "--jq",
                "[.workflow_runs[].event] | unique",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        events = json.loads(result.stdout.strip() or "[]")
        return set(events)
    except Exception:
        return set()


def detect_primary_workflow(
    workflows: list[dict[str, Any]],
    repo: str,
    *,
    get_events: Callable[[str, int], set[str]] = get_workflow_events,
) -> DetectionResult:
    """Detect the primary CI workflow from a list of active workflows.

    Checks each workflow's recent runs for push/pull_request events.
    Primary = triggered by push or pull_request events against the default
    branch. Pure function — no file I/O, no sys.exit; see DetectionResult
    for how callers should branch on the outcome.
    """
    primary_candidates = [
        wf for wf in workflows if get_events(repo, wf["id"]) & {"push", "pull_request"}
    ]

    if len(primary_candidates) == 1:
        return DetectionResult("single", workflow=primary_candidates[0])
    if len(primary_candidates) > 1:
        return DetectionResult("ambiguous", candidates=primary_candidates)
    if workflows:
        return DetectionResult("default", workflow=workflows[0])
    return DetectionResult("empty")


# ---------------------------------------------------------------------------
# collect_summary.json (formerly write_collect_summary.py)
# ---------------------------------------------------------------------------


def build_collect_summary(
    *,
    repo: str,
    workflow_id: int,
    workflow_name: str,
    p50_run_id: int,
    p50_duration_min: float,
    run_count: int,
) -> dict[str, Any]:
    return {
        "repo": repo,
        "primary_workflow_id": workflow_id,
        "primary_workflow_name": workflow_name,
        "p50_run_id": p50_run_id,
        "p50_duration_min": p50_duration_min,
        "run_count_30d": run_count,
        "collected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ---------------------------------------------------------------------------
# gh api helper
# ---------------------------------------------------------------------------


def _gh_api(path: str, *, jq: str | None = None) -> str:
    args = ["gh", "api", path]
    if jq is not None:
        args += ["--jq", jq]
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return result.stdout


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def collect(repo: str, output_dir: Path, workflow_id: int | None = None) -> int:
    """Run one full collect iteration for `repo`, writing outputs to `output_dir`.

    Mirrors the 8 steps the old collect.sh performed via separate processes
    and file handoffs, but in one process — see module docstring. Returns
    the process exit code the caller (collect.sh, or the collector agent
    directly) should use.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    t0 = timing.start()

    print(f"[collect] Step 1: fetching workflow list for {repo}", file=sys.stderr)
    workflows_raw = _gh_api(
        f"repos/{repo}/actions/workflows",
        jq='[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)',
    )
    (output_dir / "workflows.json").write_text(workflows_raw)
    workflows: list[dict[str, Any]] = json.loads(workflows_raw)

    if workflow_id is None:
        print("[collect] Detecting primary CI workflow", file=sys.stderr)
        detected = detect_primary_workflow(workflows, repo)

        if detected.status == "empty":
            print("No active workflows found.", file=sys.stderr)
            return 1

        if detected.status == "ambiguous":
            (output_dir / "workflow_candidates.json").write_text(
                json.dumps(detected.candidates, indent=2) + "\n"
            )
            names = [w["name"] for w in detected.candidates]
            print(
                f"[collect] AMBIGUOUS: {len(detected.candidates)} workflows match "
                f"push/pull_request: {names}",
                file=sys.stderr,
            )
            print(
                f"[collect] See {output_dir}/workflow_candidates.json",
                file=sys.stderr,
            )
            return 2

        assert detected.workflow is not None  # "single" and "default" both set it
        if detected.status == "default":
            wf = detected.workflow
            print(
                f"Warning: no push/pull_request triggers found; "
                f"defaulting to first active workflow: {wf['name']} (id={wf['id']})",
                file=sys.stderr,
            )
        workflow_id = detected.workflow["id"]

    primary_wf_name = next(
        (w["name"] for w in workflows if w["id"] == workflow_id), "unknown"
    )
    print(
        f"[collect] Primary workflow: {primary_wf_name} (id={workflow_id})",
        file=sys.stderr,
    )

    print("[collect] Step 2: fetching 30-day run count", file=sys.stderr)
    since = thirty_days_ago()
    count_query = f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=1"
    if since:
        count_query += f"&created=>={since}"
    run_count = int(_gh_api(count_query, jq=".total_count").strip())
    (output_dir / "run_count_primary.txt").write_text(f"{run_count}\n")

    print("[collect] Step 3: fetching workflow runs", file=sys.stderr)
    runs_raw = _gh_api(
        f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=100"
    )
    (output_dir / "runs.json").write_text(runs_raw)
    runs_payload = json.loads(runs_raw)
    runs: list[dict[str, Any]] = (
        runs_payload.get("workflow_runs", runs_payload)
        if isinstance(runs_payload, dict)
        else runs_payload
    )

    print("[collect] Step 4: computing p50 run", file=sys.stderr)
    try:
        p50_run, p50_duration, _median, _n = find_p50(runs)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    (output_dir / "p50_run.txt").write_text(
        f"{p50_run['id']}  {p50_duration:.1f}m  {p50_run.get('created_at', '')}\n"
    )

    print(
        f"[collect] Step 5: fetching jobs for p50 run {p50_run['id']}", file=sys.stderr
    )
    jobs_raw = _gh_api(f"repos/{repo}/actions/runs/{p50_run['id']}/jobs?per_page=100")
    (output_dir / "jobs.json").write_text(jobs_raw)

    print("[collect] Step 6: checking for chronic failures", file=sys.stderr)
    fc = compute_failure_check(runs)
    failure_json = (
        {"chronic": False, "failure_rate": 0.0, "details": "no_data"}
        if fc["no_data"]
        else {
            "chronic": fc["chronic"],
            "failure_rate": fc["failure_rate"],
            "details": fc["details"],
        }
    )
    (output_dir / "failure_check.json").write_text(
        json.dumps(failure_json, indent=2) + "\n"
    )

    print("[collect] Step 7: fetching secondary workflow stats", file=sys.stderr)
    secondary_ids = [str(w["id"]) for w in workflows if w["id"] != workflow_id]
    if not secondary_ids:
        (output_dir / "workflow_stats.txt").write_text("no secondary workflows\n")
    else:
        stats = subprocess.run(
            ["bash", str(SCRIPT_DIR / "fetch_workflow_stats.sh"), repo, *secondary_ids],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        (output_dir / "workflow_stats.txt").write_text(stats.stdout)

    print("[collect] Step 8: writing collect_summary.json", file=sys.stderr)
    summary = build_collect_summary(
        repo=repo,
        workflow_id=workflow_id,
        workflow_name=primary_wf_name,
        p50_run_id=p50_run["id"],
        p50_duration_min=p50_duration,
        run_count=run_count,
    )
    (output_dir / "collect_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )

    timing.write(output_dir / "collect_timing.json", timing.end(t0))

    print(
        f"COLLECT OK: {repo}  primary={primary_wf_name} id={workflow_id}  "
        f"p50_run={p50_run['id']}  runs_30d={run_count}"
    )
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect all GitHub Actions data for one eval."
    )
    parser.add_argument("--repo", required=True, help="owner/repo")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument(
        "--workflow-id",
        type=int,
        default=None,
        help="Skip auto-detection and use this workflow ID as primary",
    )
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    sys.exit(collect(args.repo, args.output_dir, args.workflow_id))


if __name__ == "__main__":
    main()
