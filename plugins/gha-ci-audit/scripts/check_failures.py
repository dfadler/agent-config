#!/usr/bin/env python3
"""
Check a workflow's run history for chronic failure patterns.

Outputs a structured summary: failure rate, consecutive-failure streak at the head
of the list, and earliest failing run in any streak. Used by agents to decide
whether to show an alert-banner in the report.

Usage:
  python3 check_failures.py runs.json
  python3 check_failures.py runs.json --output failure_check.json
  gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | python3 check_failures.py

Downstream automation should read the --output JSON file (`chronic`,
`failure_rate`, `details`) rather than the process exit code — a shell
pipeline that redirects stdout to a file (`cmd > file`) discards the exit
code unless it's captured separately. The exit code (0 = healthy, 1 =
chronic failure) is kept only as a convenience for direct/interactive CLI
use, e.g. `check_failures.py runs.json || echo alert`.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _write_json(path: str, *, chronic: bool, failure_rate: float, details: str) -> None:
    with open(path, "w") as f:
        json.dump(
            {"chronic": chronic, "failure_rate": failure_rate, "details": details},
            f,
            indent=2,
        )
        f.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "runs_file", nargs="?", help="Path to runs.json (default: stdin)"
    )
    parser.add_argument(
        "--output", help="Write a structured JSON summary to this path"
    )
    args = parser.parse_args()

    src = open(args.runs_file) if args.runs_file else sys.stdin
    raw = json.load(src)
    runs = raw.get("workflow_runs", raw) if isinstance(raw, dict) else raw

    completed = [
        r for r in runs if r.get("conclusion") and r["conclusion"] != "skipped"
    ]
    if not completed:
        print("no_data")
        if args.output:
            _write_json(args.output, chronic=False, failure_rate=0.0, details="no_data")
        sys.exit(0)

    # Failure rate across all completed runs
    failures = [r for r in completed if r["conclusion"] == "failure"]
    rate = len(failures) / len(completed)

    # Consecutive failures at the head of the list (most recent first)
    streak = 0
    for r in completed:
        if r["conclusion"] == "failure":
            streak += 1
        else:
            break

    # Earliest failure timestamp in the streak
    streak_runs = completed[:streak] if streak else []
    earliest_streak_ts = ""
    if streak_runs:
        ts_list = [r.get("created_at", "") for r in streak_runs if r.get("created_at")]
        earliest_streak_ts = min(ts_list) if ts_list else ""

    chronic = rate > 0.40 or streak >= 5

    print(f"failure_rate={rate:.2f}  failures={len(failures)}/{len(completed)}")
    print(f"consecutive_streak={streak}  earliest_in_streak={earliest_streak_ts}")
    print(f"chronic={'YES' if chronic else 'no'}")

    if args.output:
        details = (
            f"failure_rate={rate:.2f} failures={len(failures)}/{len(completed)} "
            f"consecutive_streak={streak} earliest_in_streak={earliest_streak_ts or 'n/a'}"
        )
        _write_json(
            args.output, chronic=chronic, failure_rate=round(rate, 2), details=details
        )

    sys.exit(1 if chronic else 0)


if __name__ == "__main__":
    main()
