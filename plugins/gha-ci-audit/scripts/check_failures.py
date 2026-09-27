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

This is a thin CLI wrapper — the actual logic lives in `collect_pipeline.py`
(`check_failures`), shared with the in-process collect pipeline `collect.sh`
now calls.
"""

from __future__ import annotations

import argparse
import json
import sys

from collect_pipeline import check_failures, format_failure_report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "runs_file", nargs="?", help="Path to runs.json (default: stdin)"
    )
    parser.add_argument("--output", help="Write a structured JSON summary to this path")
    args = parser.parse_args()

    src = open(args.runs_file) if args.runs_file else sys.stdin
    raw = json.load(src)

    result = check_failures(raw)
    for line in format_failure_report(result):
        print(line)

    if args.output:
        with open(args.output, "w") as f:
            json.dump(result.to_dict(), f, indent=2)
            f.write("\n")

    sys.exit(1 if result.chronic else 0)


if __name__ == "__main__":
    main()
