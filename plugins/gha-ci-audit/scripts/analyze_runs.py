#!/usr/bin/env python3
"""
Analyze GitHub Actions workflow run timing and outcomes.

Usage:
  # Pipe directly from gh api:
  gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | python3 analyze_runs.py

  # Or from a saved file:
  python3 analyze_runs.py runs.json

  # Group by event type instead of conclusion:
  python3 analyze_runs.py runs.json --group-by event
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from typing import Any

from utils import duration_minutes, parse_dt


def duration_min(r: dict[str, Any]) -> float | None:
    # Accept both full API shape and pre-projected {s, e} shape
    s = parse_dt(r.get("run_started_at") or r.get("s"))
    e = parse_dt(r.get("updated_at") or r.get("e"))
    if not s or not e:
        return None
    d = duration_minutes(s, e)
    return d if d >= 0 else None


def main() -> None:
    p = argparse.ArgumentParser(
        description="Analyze workflow run data from gh api JSON."
    )
    p.add_argument("file", nargs="?", help="JSON file (omit to read from stdin)")
    p.add_argument(
        "--group-by",
        choices=["conclusion", "event"],
        default="conclusion",
        help="Primary grouping dimension (default: conclusion)",
    )
    args = p.parse_args()

    src = open(args.file) if args.file else sys.stdin
    raw = json.load(src)

    # Handle raw API response or pre-filtered array
    runs = raw.get("workflow_runs", raw) if isinstance(raw, dict) else raw
    completed = [
        r for r in runs if r.get("conclusion") and r["conclusion"] not in ("skipped",)
    ]

    if not completed:
        print("No completed runs found.")
        return

    print(f"Completed runs: {len(completed)}  (total in payload: {len(runs)})")
    print()

    # Group by chosen dimension
    groups: dict[str, list[float]] = {}
    no_duration = 0
    for r in completed:
        key = (
            r.get("event") if args.group_by == "event" else r.get("conclusion")
        ) or "unknown"
        d = duration_min(r)
        if d is not None:
            groups.setdefault(key, []).append(d)
        else:
            no_duration += 1

    print(f"By {args.group_by}:")
    for key, ds in sorted(groups.items(), key=lambda x: -len(x[1])):
        avg = statistics.mean(ds)
        med = statistics.median(ds)
        sd = statistics.stdev(ds) if len(ds) > 1 else 0
        print(
            f"  {key}: n={len(ds)}, avg={avg:.1f}m, median={med:.1f}m, stdev={sd:.1f}m"
        )

    if no_duration:
        print(f"  (skipped {no_duration} runs with missing timestamps)")
    print()

    # Overall percentiles across all completed runs
    all_durs = sorted(d for ds in groups.values() for d in ds)
    if not all_durs:
        return

    n = len(all_durs)
    p50 = all_durs[n // 2]
    p90 = all_durs[int(n * 0.9)]
    p99 = all_durs[int(n * 0.99)] if n >= 100 else all_durs[-1]
    print("Duration percentiles (all conclusions):")
    print(f"  p50={p50:.1f}m  p90={p90:.1f}m  p99={p99:.1f}m  max={all_durs[-1]:.1f}m")
    print()

    # Bucket distribution
    thresholds = [
        ("<2m", 0, 2),
        ("2–5m", 2, 5),
        ("5–15m", 5, 15),
        ("15–30m", 15, 30),
        (">30m", 30, float("inf")),
    ]
    print("Duration buckets:")
    for label, lo, hi in thresholds:
        count = sum(1 for d in all_durs if lo <= d < hi)
        pct = count / n * 100
        bar = "█" * int(pct / 2)
        print(f"  {label:8s}: {count:4d} ({pct:4.1f}%) {bar}")


if __name__ == "__main__":
    main()
