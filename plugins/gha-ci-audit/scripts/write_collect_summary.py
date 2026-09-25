#!/usr/bin/env python3
"""Write collect_summary.json for a completed data collection run.

Usage:
    python3 write_collect_summary.py \\
        --outputs-dir <path> --repo <owner/repo> \\
        --workflow-id <id> --workflow-name <name> \\
        --p50-run-id <id> --p50-duration-min <minutes> \\
        --run-count <count>

Writes collect_summary.json to outputs_dir and prints it to stdout.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write collect_summary.json for a completed data collection run."
    )
    parser.add_argument(
        "--outputs-dir",
        required=True,
        type=Path,
        help="Path to the eval's outputs/ directory",
    )
    parser.add_argument("--repo", required=True, help="owner/repo (e.g. vitejs/vite)")
    parser.add_argument(
        "--workflow-id", required=True, type=int, help="Numeric primary workflow ID"
    )
    parser.add_argument(
        "--workflow-name", required=True, help="Human-readable primary workflow name"
    )
    parser.add_argument(
        "--p50-run-id",
        required=True,
        type=int,
        help="Run ID of the p50-representative run",
    )
    parser.add_argument(
        "--p50-duration-min",
        required=True,
        type=float,
        help="Duration of the p50 run in minutes",
    )
    parser.add_argument(
        "--run-count", required=True, type=int, help="Total runs in the last 30 days"
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    summary = {
        "repo": args.repo,
        "primary_workflow_id": args.workflow_id,
        "primary_workflow_name": args.workflow_name,
        "p50_run_id": args.p50_run_id,
        "p50_duration_min": args.p50_duration_min,
        "run_count_30d": args.run_count,
        "collected_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    out = args.outputs_dir / "collect_summary.json"
    out.write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
