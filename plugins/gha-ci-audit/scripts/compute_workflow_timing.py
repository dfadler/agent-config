#!/usr/bin/env python3
"""Compute avg and p90 duration (minutes) for a list of workflow runs.

Reads a GitHub Actions workflow runs JSON array from stdin
(as returned by `gh api .../runs --jq '[.workflow_runs[] | ...]'`).

Output: one line — "<avg_min>  <p90_min>" or "?  ?" if no data.
"""

from __future__ import annotations

import json
import statistics
import sys

from utils import duration_minutes, parse_dt


def main() -> None:
    try:
        runs = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        print("?  ?")
        sys.exit(0)

    durs = []
    for r in runs:
        try:
            s = parse_dt(r["s"])
            e = parse_dt(r["e"])
            if s is None or e is None:
                continue
            d = duration_minutes(s, e)
            if d >= 0:
                durs.append(d)
        except Exception:
            pass

    if not durs:
        print("?  ?")
    else:
        durs.sort()
        avg = statistics.mean(durs)
        p90 = durs[int(len(durs) * 0.9)]
        print(f"{avg:.1f}  {p90:.1f}")


if __name__ == "__main__":
    main()
