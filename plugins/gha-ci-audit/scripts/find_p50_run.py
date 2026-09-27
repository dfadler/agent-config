#!/usr/bin/env python3
"""
Find the successful workflow run whose duration is closest to the p50 (median).

Usage:
  python3 find_p50_run.py runs.json
  gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" | python3 find_p50_run.py

Output (one line): <run_id>  <duration_min>m  <created_at>
Use the run_id with analyze_jobs.py for critical-path analysis.

This is a thin CLI wrapper — the actual logic lives in `collect_pipeline.py`
(`find_p50_run`), shared with the in-process collect pipeline `collect.sh`
now calls.
"""

from __future__ import annotations

import json
import sys

from collect_pipeline import find_p50_run


def main() -> None:
    src = open(sys.argv[1]) if len(sys.argv) > 1 else sys.stdin
    raw = json.load(src)

    result = find_p50_run(raw)
    if result is None:
        print("No successful runs with duration data found.", file=sys.stderr)
        sys.exit(1)

    print(f"{result.run_id}  {result.duration_min:.1f}m  {result.created_at}")
    print(f"# p50={result.p50:.1f}m  n={result.n} successful runs", file=sys.stderr)


if __name__ == "__main__":
    main()
