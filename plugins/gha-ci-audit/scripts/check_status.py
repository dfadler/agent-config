#!/usr/bin/env python3
"""
Check the status of an eval iteration — what has outputs, what's been graded,
what's still missing.

Usage:
    python3 check_status.py <iteration_dir>

Output:
    A table showing each eval run's status: outputs present, graded, timing saved.
    Exits non-zero if any run is incomplete.
"""

import json
import sys
from pathlib import Path

CHECKMARK = "✓"
CROSS = "✗"
DASH = "—"


def check_run(run_dir: Path) -> dict:
    outputs_dir = run_dir / "outputs"
    has_outputs = outputs_dir.exists() and any(outputs_dir.iterdir())
    has_report = (outputs_dir / "report.html").exists() if outputs_dir.exists() else False
    has_grading = (run_dir / "grading.json").exists()
    has_timing = (run_dir / "timing.json").exists()
    has_metadata = (run_dir / "eval_metadata.json").exists()

    pass_rate = None
    if has_grading:
        try:
            grading = json.loads((run_dir / "grading.json").read_text())
            pass_rate = grading.get("summary", {}).get("pass_rate")
        except (json.JSONDecodeError, OSError):
            pass

    return {
        "has_metadata": has_metadata,
        "has_outputs": has_outputs,
        "has_report": has_report,
        "has_grading": has_grading,
        "has_timing": has_timing,
        "pass_rate": pass_rate,
        "complete": has_report and has_grading,
    }


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <iteration_dir>", file=sys.stderr)
        sys.exit(1)

    iteration_dir = Path(sys.argv[1])
    if not iteration_dir.exists():
        print(f"Not found: {iteration_dir}", file=sys.stderr)
        sys.exit(1)

    # Discover eval dirs (any directory that has a with_skill subdir)
    eval_dirs = sorted(
        d for d in iteration_dir.iterdir()
        if d.is_dir() and (d / "with_skill").exists()
    )

    if not eval_dirs:
        print(f"No eval directories found in {iteration_dir}")
        sys.exit(0)

    # Print header
    col_w = 22
    print(f"\n{'Eval':<25} {'Cond':<14} {'Metadata':<10} {'Report':<8} {'Graded':<8} {'Timing':<8} {'PassRate'}")
    print("-" * 90)

    any_incomplete = False

    for eval_dir in eval_dirs:
        eval_name = eval_dir.name

        for condition in ["with_skill"]:
            run_dir = eval_dir / condition
            if not run_dir.exists():
                print(f"  {eval_name:<23} {condition:<14} {'(missing)'}")
                any_incomplete = True
                continue

            status = check_run(run_dir)

            meta_sym = CHECKMARK if status["has_metadata"] else CROSS
            report_sym = CHECKMARK if status["has_report"] else CROSS
            grade_sym = CHECKMARK if status["has_grading"] else CROSS
            timing_sym = CHECKMARK if status["has_timing"] else DASH
            pass_str = f"{status['pass_rate']:.0%}" if status["pass_rate"] is not None else DASH

            print(
                f"  {eval_name:<23} {condition:<14} "
                f"{meta_sym:<10} {report_sym:<8} {grade_sym:<8} {timing_sym:<8} {pass_str}"
            )

            if not status["complete"]:
                any_incomplete = True

    print()

    # Summary
    graded = sum(
        1
        for eval_dir in eval_dirs
        if (eval_dir / "with_skill" / "grading.json").exists()
    )
    total_runs = len(eval_dirs)

    # Check for benchmark
    benchmark_path = iteration_dir / "benchmark.json"
    benchmark_status = CHECKMARK if benchmark_path.exists() else CROSS
    print(f"Graded: {graded}/{total_runs} runs    benchmark.json: {benchmark_status}")
    print()

    if any_incomplete:
        print("⚠  Some runs are incomplete. See above.")
        sys.exit(1)
    else:
        print("All runs complete.")
        sys.exit(0)


if __name__ == "__main__":
    main()
