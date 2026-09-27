#!/usr/bin/env python3
"""Concentrated collect-side pipeline for gha-ci-audit.

Previously, `collect.sh` orchestrated the collect phase by shelling out to
six separate one-off CLIs (`detect_primary_workflow.py`, `find_p50_run.py`,
`check_failures.py`, `fetch_workflow_stats.sh`, `write_collect_summary.py`,
`write_collect_timing.py`), each writing its result to a file in
`$OUTPUT_DIR` for the next step (or `collect.sh` itself) to read back. That
file-based handoff only existed because those steps ran as separate
processes — it added no value within a single `collect.sh` invocation.

This module concentrates the collect-side business logic
(`detect_primary_workflow`, `find_p50_run`, `check_failures`, and
`build_collect_summary`) behind one interface: `collect(...) -> CollectResult`.
`collect.sh` now calls this module's CLI once instead of making those six
subprocess calls; all of the intermediate values are passed as plain Python
objects instead of round-tripping through files. The output *files*
`collect.sh`'s callers depend on (`workflows.json`, `runs.json`, `jobs.json`,
`failure_check.json`, `workflow_stats.txt`, `run_count_primary.txt`,
`p50_run.txt`, `collect_summary.json`, `collect_timing.json`, and
`workflow_candidates.json` on the ambiguous path) are unchanged — only the
plumbing that produces them moved in-process.

`fetch_workflow_stats.sh` (secondary-workflow stats) and
`compute_workflow_timing.py` (which it calls) are out of scope for this
concentration — they're invoked as a subprocess exactly as `collect.sh` used
to invoke them.

`find_p50_run.py` and `check_failures.py` remain as separate files because
they're also invoked directly, outside `collect.sh`, by the interactive
skill flow (see `skills/gha-ci-audit/SKILL.md`). They're now thin CLI
wrappers over this module's `find_p50_run`/`check_failures` functions rather
than independent implementations.

Usage:
    python3 collect_pipeline.py --repo <owner/repo> --output-dir <path> \\
        [--workflow-id <id>]

Exit codes (matches the old `collect.sh` contract):
    0  Success — all output files written
    1  Fatal error
    2  Ambiguous primary workflow — workflow_candidates.json written; caller
       must re-invoke with --workflow-id <id> after AI disambiguation
"""

from __future__ import annotations

import json
import statistics
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import timing
from utils import duration_minutes, parse_dt, thirty_days_ago

# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CollectFatalError(Exception):
    """An unrecoverable collection failure. The CLI maps this to exit code 1."""


class AmbiguousPrimaryWorkflowError(Exception):
    """Raised when more than one workflow looks like the primary CI workflow.

    By the time this is raised, `collect()` has already written
    `workflow_candidates.json` to `candidates_path` — the CLI maps this to
    exit code 2 so the caller can re-invoke with `--workflow-id` after
    disambiguation.
    """

    def __init__(self, candidates_path: Path) -> None:
        super().__init__(f"Ambiguous primary workflow; see {candidates_path}")
        self.candidates_path = candidates_path


# ---------------------------------------------------------------------------
# Primary workflow detection
# ---------------------------------------------------------------------------


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
        events: list[str] = json.loads(result.stdout.strip() or "[]")
        return set(events)
    except Exception:
        return set()


@dataclass(frozen=True)
class PrimaryWorkflowResult:
    """Outcome of detecting the primary CI workflow.

    Exactly one of `workflow` (a single confident match, possibly the
    no-match fallback — see `warning`) or `ambiguous` (multiple matches, in
    `candidates`) describes what happened. `workflow is None and not
    ambiguous` means no active workflows were given at all.
    """

    workflow: dict[str, Any] | None
    candidates: list[dict[str, Any]]
    ambiguous: bool
    warning: str | None = None


def detect_primary_workflow(
    workflows: list[dict[str, Any]], repo: str
) -> PrimaryWorkflowResult:
    """Detect the primary CI workflow from a list of active workflows.

    Primary = triggered by push or pull_request events against the default
    branch (checked via each workflow's recent run history).
    """
    primary_candidates: list[dict[str, Any]] = []
    for wf in workflows:
        events = get_workflow_events(repo, wf["id"])
        if "push" in events or "pull_request" in events:
            primary_candidates.append(wf)

    if len(primary_candidates) == 1:
        return PrimaryWorkflowResult(
            workflow=primary_candidates[0], candidates=[], ambiguous=False
        )

    if len(primary_candidates) > 1:
        return PrimaryWorkflowResult(
            workflow=None, candidates=primary_candidates, ambiguous=True
        )

    if workflows:
        wf = workflows[0]
        warning = (
            "Warning: no push/pull_request triggers found; "
            f"defaulting to first active workflow: {wf['name']} (id={wf['id']})"
        )
        return PrimaryWorkflowResult(
            workflow=wf, candidates=[], ambiguous=False, warning=warning
        )

    return PrimaryWorkflowResult(
        workflow=None,
        candidates=[],
        ambiguous=False,
        warning="No active workflows found.",
    )


# ---------------------------------------------------------------------------
# p50 run selection
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class P50Result:
    run_id: int
    duration_min: float
    created_at: str
    p50: float
    n: int


def _run_duration_min(r: dict[str, Any]) -> float | None:
    s = parse_dt(r.get("run_started_at"))
    e = parse_dt(r.get("updated_at"))
    if not s or not e:
        return None
    d = duration_minutes(s, e)
    return d if d >= 0 else None


def find_p50_run(runs_payload: Any) -> P50Result | None:
    """Find the successful run whose duration is closest to the p50 (median).

    `runs_payload` is either a raw GitHub API runs response (a dict with a
    `workflow_runs` key) or a bare list of run objects.
    """
    runs = (
        runs_payload.get("workflow_runs", runs_payload)
        if isinstance(runs_payload, dict)
        else runs_payload
    )

    successful = [r for r in runs if r.get("conclusion") == "success"]
    with_dur_raw = [(_run_duration_min(r), r) for r in successful]
    with_dur: list[tuple[float, dict[str, Any]]] = cast(
        "list[tuple[float, dict[str, Any]]]",
        [(d, r) for d, r in with_dur_raw if d is not None],
    )

    if not with_dur:
        return None

    durations = [d for d, _ in with_dur]
    p50 = statistics.median(durations)
    best_d, best_r = min(with_dur, key=lambda x: abs(x[0] - p50))

    return P50Result(
        run_id=int(best_r["id"]),
        duration_min=best_d,
        created_at=str(best_r.get("created_at", "")),
        p50=p50,
        n=len(durations),
    )


# ---------------------------------------------------------------------------
# Chronic-failure check
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FailureCheck:
    chronic: bool
    failure_rate: float
    details: str
    no_data: bool = False
    streak: int = 0
    failures: int = 0
    completed: int = 0
    earliest_in_streak: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "chronic": self.chronic,
            "failure_rate": self.failure_rate,
            "details": self.details,
        }


def check_failures(runs_payload: Any) -> FailureCheck:
    """Check a workflow's run history for chronic failure patterns.

    `runs_payload` is either a raw GitHub API runs response (a dict with a
    `workflow_runs` key) or a bare list of run objects.
    """
    runs = (
        runs_payload.get("workflow_runs", runs_payload)
        if isinstance(runs_payload, dict)
        else runs_payload
    )

    completed = [
        r for r in runs if r.get("conclusion") and r["conclusion"] != "skipped"
    ]
    if not completed:
        return FailureCheck(
            chronic=False, failure_rate=0.0, details="no_data", no_data=True
        )

    failures = [r for r in completed if r["conclusion"] == "failure"]
    rate = len(failures) / len(completed)

    streak = 0
    for r in completed:
        if r["conclusion"] == "failure":
            streak += 1
        else:
            break

    streak_runs = completed[:streak] if streak else []
    earliest_streak_ts = ""
    if streak_runs:
        ts_list = [r.get("created_at", "") for r in streak_runs if r.get("created_at")]
        earliest_streak_ts = min(ts_list) if ts_list else ""

    chronic = rate > 0.40 or streak >= 5
    details = (
        f"failure_rate={rate:.2f} failures={len(failures)}/{len(completed)} "
        f"consecutive_streak={streak} earliest_in_streak={earliest_streak_ts or 'n/a'}"
    )
    return FailureCheck(
        chronic=chronic,
        failure_rate=round(rate, 2),
        details=details,
        streak=streak,
        failures=len(failures),
        completed=len(completed),
        earliest_in_streak=earliest_streak_ts,
    )


def format_failure_report(fc: FailureCheck) -> list[str]:
    """Render the human-readable lines `check_failures.py` used to print."""
    if fc.no_data:
        return ["no_data"]
    return [
        f"failure_rate={fc.failure_rate:.2f}  failures={fc.failures}/{fc.completed}",
        f"consecutive_streak={fc.streak}  earliest_in_streak={fc.earliest_in_streak}",
        f"chronic={'YES' if fc.chronic else 'no'}",
    ]


# ---------------------------------------------------------------------------
# collect_summary.json
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
# GitHub API access
# ---------------------------------------------------------------------------


def run_gh_api(args: list[str]) -> str:
    """Run `gh api <args>` and return raw stdout, raising on failure."""
    result = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if result.returncode != 0:
        raise CollectFatalError(
            f"gh api {' '.join(args)} failed: {result.stderr.strip()}"
        )
    return result.stdout


def fetch_secondary_stats(
    repo: str, secondary_ids: list[int], scripts_dir: Path
) -> str:
    """Fetch counts + avg/p90 timing for secondary workflows.

    Delegates to the unchanged `fetch_workflow_stats.sh` (and, transitively,
    `compute_workflow_timing.py`) — both out of scope for this concentration.
    """
    if not secondary_ids:
        return "no secondary workflows\n"

    script = scripts_dir / "fetch_workflow_stats.sh"
    result = subprocess.run(
        ["bash", str(script), repo, *[str(i) for i in secondary_ids]],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if result.returncode != 0:
        raise CollectFatalError(
            f"fetch_workflow_stats.sh failed: {result.stdout.strip()}"
        )
    return result.stdout


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CollectResult:
    repo: str
    workflow_id: int
    workflow_name: str
    p50_run_id: int
    run_count: int
    summary: dict[str, Any] = field(repr=False)


def collect(
    *,
    repo: str,
    output_dir: Path,
    workflow_id: int | None,
    scripts_dir: Path,
) -> CollectResult:
    """Run one full collect iteration, writing every output file `collect.sh`
    used to produce, and return a summary of what was collected.

    Raises `AmbiguousPrimaryWorkflowError` (exit 2) or `CollectFatalError`
    (exit 1) on failure — see the module docstring for the exit-code
    contract this preserves from the old `collect.sh`.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    marker = timing.start()

    # -- Step 1: discover active workflows -----------------------------
    print(f"[collect] Step 1: fetching workflow list for {repo}", file=sys.stderr)
    workflows_raw = run_gh_api(
        [
            f"repos/{repo}/actions/workflows",
            "--jq",
            '[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)',
        ]
    )
    (output_dir / "workflows.json").write_text(workflows_raw)
    workflows: list[dict[str, Any]] = (
        json.loads(workflows_raw) if workflows_raw.strip() else []
    )

    # -- Primary workflow detection --------------------------------------
    if workflow_id is None:
        print("[collect] Detecting primary CI workflow", file=sys.stderr)
        detection = detect_primary_workflow(workflows, repo)

        if detection.ambiguous:
            candidates_path = output_dir / "workflow_candidates.json"
            candidates_path.write_text(
                json.dumps(detection.candidates, indent=2) + "\n"
            )
            names = [w["name"] for w in detection.candidates]
            print(
                "[collect] AMBIGUOUS: multiple primary workflow candidates found.",
                file=sys.stderr,
            )
            print(f"[collect] See {candidates_path}", file=sys.stderr)
            print(
                f"Ambiguous: {len(detection.candidates)} workflows match "
                f"push/pull_request: {names}",
                file=sys.stderr,
            )
            raise AmbiguousPrimaryWorkflowError(candidates_path)

        if detection.workflow is None:
            message = detection.warning or "No active workflows found."
            print(message, file=sys.stderr)
            raise CollectFatalError(message)

        if detection.warning:
            print(detection.warning, file=sys.stderr)
        workflow_id = int(detection.workflow["id"])

    # Resolve the human-readable workflow name from workflows.json
    primary_wf_name = "unknown"
    for wf in workflows:
        if wf.get("id") == workflow_id:
            primary_wf_name = str(wf.get("name") or "unknown")
            break

    print(
        f"[collect] Primary workflow: {primary_wf_name} (id={workflow_id})",
        file=sys.stderr,
    )

    # -- Step 2: run count (last 30 days) --------------------------------
    print("[collect] Step 2: fetching 30-day run count", file=sys.stderr)
    since = thirty_days_ago()
    count_query = f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=1"
    if since:
        count_query += f"&created=>={since}"
    run_count_raw = run_gh_api([count_query, "--jq", ".total_count"])
    (output_dir / "run_count_primary.txt").write_text(run_count_raw)
    run_count = int(run_count_raw.strip())

    # -- Step 3: recent runs (last 100) ----------------------------------
    print("[collect] Step 3: fetching workflow runs", file=sys.stderr)
    runs_raw = run_gh_api(
        [f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=100"]
    )
    (output_dir / "runs.json").write_text(runs_raw)
    runs_payload: Any = json.loads(runs_raw) if runs_raw.strip() else {}

    # -- Step 4: p50 representative run -----------------------------------
    print("[collect] Step 4: computing p50 run", file=sys.stderr)
    p50 = find_p50_run(runs_payload)
    if p50 is None:
        raise CollectFatalError("No successful runs with duration data found.")
    (output_dir / "p50_run.txt").write_text(
        f"{p50.run_id}  {p50.duration_min:.1f}m  {p50.created_at}\n"
    )
    print(f"# p50={p50.p50:.1f}m  n={p50.n} successful runs", file=sys.stderr)

    # -- Step 5: jobs for the p50 run -------------------------------------
    print(f"[collect] Step 5: fetching jobs for p50 run {p50.run_id}", file=sys.stderr)
    jobs_raw = run_gh_api([f"repos/{repo}/actions/runs/{p50.run_id}/jobs?per_page=100"])
    (output_dir / "jobs.json").write_text(jobs_raw)

    # -- Step 6: chronic-failure check -------------------------------------
    print("[collect] Step 6: checking for chronic failures", file=sys.stderr)
    failure = check_failures(runs_payload)
    for line in format_failure_report(failure):
        print(line, file=sys.stderr)
    (output_dir / "failure_check.json").write_text(
        json.dumps(failure.to_dict(), indent=2) + "\n"
    )

    # -- Step 7: secondary workflow stats ----------------------------------
    print("[collect] Step 7: fetching secondary workflow stats", file=sys.stderr)
    secondary_ids = [int(wf["id"]) for wf in workflows if wf.get("id") != workflow_id]
    workflow_stats_raw = fetch_secondary_stats(repo, secondary_ids, scripts_dir)
    (output_dir / "workflow_stats.txt").write_text(workflow_stats_raw)

    # -- Step 8: collect_summary.json --------------------------------------
    print("[collect] Step 8: writing collect_summary.json", file=sys.stderr)
    summary = build_collect_summary(
        repo=repo,
        workflow_id=workflow_id,
        workflow_name=primary_wf_name,
        p50_run_id=p50.run_id,
        p50_duration_min=p50.duration_min,
        run_count=run_count,
    )
    (output_dir / "collect_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n"
    )

    # -- Timing: collect_timing.json ---------------------------------------
    timing_result = timing.end(marker)
    (output_dir / "collect_timing.json").write_text(
        json.dumps(timing_result.to_dict(), indent=2) + "\n"
    )

    return CollectResult(
        repo=repo,
        workflow_id=workflow_id,
        workflow_name=primary_wf_name,
        p50_run_id=p50.run_id,
        run_count=run_count,
        summary=summary,
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str]) -> tuple[str, Path, int | None]:
    """Manual argv parsing (not argparse) so a bad invocation exits 1, not
    argparse's default 2 — exit code 2 is reserved for "ambiguous primary
    workflow" in this script's contract."""
    repo = ""
    output_dir = ""
    workflow_id: int | None = None

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--repo" and i + 1 < len(argv):
            repo = argv[i + 1]
            i += 2
        elif arg == "--output-dir" and i + 1 < len(argv):
            output_dir = argv[i + 1]
            i += 2
        elif arg == "--workflow-id" and i + 1 < len(argv):
            workflow_id = int(argv[i + 1])
            i += 2
        else:
            print(f"Unknown argument: {arg}", file=sys.stderr)
            sys.exit(1)

    if not repo:
        print("--repo is required", file=sys.stderr)
        sys.exit(1)
    if not output_dir:
        print("--output-dir is required", file=sys.stderr)
        sys.exit(1)

    return repo, Path(output_dir), workflow_id


def main() -> None:
    repo, output_dir, workflow_id = _parse_args(sys.argv[1:])
    scripts_dir = Path(__file__).resolve().parent

    try:
        result = collect(
            repo=repo,
            output_dir=output_dir,
            workflow_id=workflow_id,
            scripts_dir=scripts_dir,
        )
    except AmbiguousPrimaryWorkflowError:
        sys.exit(2)
    except CollectFatalError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(
        f"COLLECT OK: {result.repo}  primary={result.workflow_name} "
        f"id={result.workflow_id}  p50_run={result.p50_run_id}  "
        f"runs_30d={result.run_count}"
    )


if __name__ == "__main__":
    main()
