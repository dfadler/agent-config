#!/usr/bin/env python3
"""
Find the successful workflow run whose duration is closest to the p50 (median).

Usage:
  python3 find_p50_run.py runs.json
  gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | python3 find_p50_run.py

Output (one line): <run_id>  <duration_min>m  <created_at>
Use the run_id with analyze_jobs.py for critical-path analysis.

find_p50() below is also imported directly by gha_ci_audit_collect.py so the
in-process collect pipeline doesn't have to shell out to this script and
round-trip the result through a file (issue #368).
"""

from __future__ import annotations

import json
import statistics
import sys
from typing import Any, cast

from utils import duration_minutes, parse_dt


def duration_min(r: dict[str, Any]) -> float | None:
    s = parse_dt(r.get("run_started_at"))
    e = parse_dt(r.get("updated_at"))
    if not s or not e:
        return None
    d = duration_minutes(s, e)
    return d if d >= 0 else None


def find_p50(runs: list[dict[str, Any]]) -> tuple[dict[str, Any], float, float, int]:
    """Find the successful run closest to the median duration.

    Returns (best_run, best_duration_min, median_min, n_successful).
    Raises ValueError if no successful run has usable duration data.
    """
    successful = [r for r in runs if r.get("conclusion") == "success"]
    with_dur_raw = [(duration_min(r), r) for r in successful]
    with_dur: list[tuple[float, dict[str, Any]]] = cast(
        "list[tuple[float, dict[str, Any]]]",
        [(d, r) for d, r in with_dur_raw if d is not None],
    )

    if not with_dur:
        raise ValueError("No successful runs with duration data found.")

    durations = [d for d, _ in with_dur]
    p50 = statistics.median(durations)
    best_d, best_r = min(with_dur, key=lambda x: abs(x[0] - p50))
    return best_r, best_d, p50, len(durations)


def main() -> None:
    src = open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin
    raw = json.load(src)
    runs = raw.get("workflow_runs", raw) if isinstance(raw, dict) else raw

    try:
        best_r, best_d, p50, n = find_p50(runs)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)

    print(f"{best_r['id']}  {best_d:.1f}m  {best_r.get('created_at', '')}")
    print(f"# p50={p50:.1f}m  n={n} successful runs", file=sys.stderr)


if __name__ == "__main__":
    main()
