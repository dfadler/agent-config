#!/usr/bin/env python3
"""Write collect_summary.json for a completed data collection run.

Usage:
    python3 write_collect_summary.py <outputs_dir> <repo> <primary_workflow_id> \
        <primary_workflow_name> <p50_run_id> <p50_duration_min> <run_count_30d>

Arguments:
    outputs_dir           Path to the eval's outputs/ directory
    repo                  owner/repo (e.g. vitejs/vite)
    primary_workflow_id   Numeric workflow ID
    primary_workflow_name Human-readable workflow name
    p50_run_id            Run ID of the p50-representative run
    p50_duration_min      Duration of that run in minutes (float)
    run_count_30d         Total runs in the last 30 days (int)

Writes collect_summary.json to outputs_dir and prints it to stdout.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main():
    if len(sys.argv) != 8:
        print(
            "Usage: write_collect_summary.py <outputs_dir> <repo> <primary_workflow_id> "
            "<primary_workflow_name> <p50_run_id> <p50_duration_min> <run_count_30d>",
            file=sys.stderr,
        )
        sys.exit(1)

    outputs_dir = Path(sys.argv[1])
    repo = sys.argv[2]
    primary_workflow_id = int(sys.argv[3])
    primary_workflow_name = sys.argv[4]
    p50_run_id = int(sys.argv[5])
    p50_duration_min = float(sys.argv[6])
    run_count_30d = int(sys.argv[7])

    summary = {
        "repo": repo,
        "primary_workflow_id": primary_workflow_id,
        "primary_workflow_name": primary_workflow_name,
        "p50_run_id": p50_run_id,
        "p50_duration_min": p50_duration_min,
        "run_count_30d": run_count_30d,
        "collected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    out = outputs_dir / "collect_summary.json"
    out.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
