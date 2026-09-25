#!/usr/bin/env python3
"""
Check a workflow's run history for chronic failure patterns.

Outputs a structured summary: failure rate, consecutive-failure streak at the head
of the list, and earliest failing run in any streak. Used by agents to decide
whether to show an alert-banner in the report.

Usage:
  python3 check_failures.py runs.json
  gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | python3 check_failures.py

Exit code:
  0 — no chronic failure signal
  1 — chronic failure detected (rate >40% OR streak >=5 consecutive failures)
"""

from __future__ import annotations

import json
import sys
from datetime import datetime


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def main() -> None:
    src = open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin
    raw = json.load(src)
    runs = raw.get("workflow_runs", raw) if isinstance(raw, dict) else raw

    completed = [
        r for r in runs if r.get("conclusion") and r["conclusion"] != "skipped"
    ]
    if not completed:
        print("no_data")
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

    sys.exit(1 if chronic else 0)


if __name__ == "__main__":
    main()
