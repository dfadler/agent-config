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

compute_failure_check() below is also imported directly by
gha_ci_audit_collect.py so the in-process collect pipeline doesn't have to
shell out to this script and round-trip the result through a file
(issue #368).
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any


def compute_failure_check(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute the chronic-failure signal for a list of workflow runs.

    Always returns a dict with a `no_data` key. When `no_data` is True the
    other fields are meaningless placeholders (mirrors the "no_data" CLI
    output); otherwise the dict also carries `chronic`, `failure_rate`
    (rounded to 2 decimals), `details`, `failure_rate_raw`, `failures`,
    `completed`, `streak`, and `earliest_streak_ts`.
    """
    completed = [
        r for r in runs if r.get("conclusion") and r["conclusion"] != "skipped"
    ]
    if not completed:
        return {
            "no_data": True,
            "chronic": False,
            "failure_rate": 0.0,
            "details": "no_data",
        }

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

    details = (
        f"failure_rate={rate:.2f} failures={len(failures)}/{len(completed)} "
        f"consecutive_streak={streak} earliest_in_streak={earliest_streak_ts or 'n/a'}"
    )

    return {
        "no_data": False,
        "chronic": chronic,
        "failure_rate": round(rate, 2),
        "details": details,
        "failure_rate_raw": rate,
        "failures": len(failures),
        "completed": len(completed),
        "streak": streak,
        "earliest_streak_ts": earliest_streak_ts,
    }


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
    parser.add_argument("--output", help="Write a structured JSON summary to this path")
    args = parser.parse_args()

    src = open(args.runs_file) if args.runs_file else sys.stdin
    raw = json.load(src)
    runs = raw.get("workflow_runs", raw) if isinstance(raw, dict) else raw

    result = compute_failure_check(runs)

    if result["no_data"]:
        print("no_data")
        if args.output:
            _write_json(args.output, chronic=False, failure_rate=0.0, details="no_data")
        sys.exit(0)

    print(
        f"failure_rate={result['failure_rate_raw']:.2f}  "
        f"failures={result['failures']}/{result['completed']}"
    )
    print(
        f"consecutive_streak={result['streak']}  "
        f"earliest_in_streak={result['earliest_streak_ts']}"
    )
    print(f"chronic={'YES' if result['chronic'] else 'no'}")

    if args.output:
        _write_json(
            args.output,
            chronic=result["chronic"],
            failure_rate=result["failure_rate"],
            details=result["details"],
        )

    sys.exit(1 if result["chronic"] else 0)


if __name__ == "__main__":
    main()
