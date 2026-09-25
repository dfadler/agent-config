#!/usr/bin/env python3
"""
Aggregate grading results from an eval iteration into benchmark.json.

Expects this directory layout (gha-ci-audit workspace structure):

    <iteration_dir>/
    ├── <eval_name>/
    │   └── with_skill/
    │       ├── eval_metadata.json
    │       ├── grading.json
    │       ├── timing.json          (optional)
    │       └── outputs/report.html
    └── ...

Usage:
    python3 aggregate.py <iteration_dir> [--skill-name NAME]

Output:
    <iteration_dir>/benchmark.json
    <iteration_dir>/benchmark.md
"""

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path


def stats(values: list[float]) -> dict:
    if not values:
        return {"mean": 0.0, "stddev": 0.0, "min": 0.0, "max": 0.0}
    n = len(values)
    mean = sum(values) / n
    stddev = math.sqrt(sum((x - mean) ** 2 for x in values) / (n - 1)) if n > 1 else 0.0
    return {
        "mean": round(mean, 4),
        "stddev": round(stddev, 4),
        "min": round(min(values), 4),
        "max": round(max(values), 4),
    }


def load_run(run_dir: Path) -> dict | None:
    grading_path = run_dir / "grading.json"
    metadata_path = run_dir / "eval_metadata.json"

    if not grading_path.exists():
        return None

    try:
        grading = json.loads(grading_path.read_text())
    except json.JSONDecodeError as e:
        print(f"Warning: bad JSON in {grading_path}: {e}", file=sys.stderr)
        return None

    eval_id = 0
    eval_name = run_dir.parent.name
    if metadata_path.exists():
        try:
            meta = json.loads(metadata_path.read_text())
            eval_id = meta.get("eval_id", 0)
            eval_name = meta.get("eval_name", eval_name)
        except json.JSONDecodeError:
            pass

    summary = grading.get("summary", {})
    result = {
        "eval_id": eval_id,
        "eval_name": eval_name,
        "configuration": run_dir.name,  # "with_skill" or "without_skill"
        "pass_rate": summary.get("pass_rate", 0.0),
        "passed": summary.get("passed", 0),
        "failed": summary.get("failed", 0),
        "total": summary.get("total", 0),
        "time_seconds": 0.0,
        "tokens": 0,
        "tool_calls": grading.get("execution_metrics", {}).get("total_tool_calls", 0),
        "errors": grading.get("execution_metrics", {}).get("errors_encountered", 0),
        "expectations": grading.get("expectations", []),
        "notes": [],
    }

    # Timing — from timing.json or grading.json
    timing_path = run_dir / "timing.json"
    if timing_path.exists():
        try:
            t = json.loads(timing_path.read_text())
            result["time_seconds"] = t.get("total_duration_seconds", 0.0)
            result["tokens"] = t.get("total_tokens", 0)
        except json.JSONDecodeError:
            pass
    if result["time_seconds"] == 0.0:
        result["time_seconds"] = grading.get("timing", {}).get("total_duration_seconds", 0.0)

    # Notes from grading
    notes_summary = grading.get("user_notes_summary", {})
    for key in ("uncertainties", "needs_review", "workarounds"):
        result["notes"].extend(notes_summary.get(key, []))

    return result


def load_all(iteration_dir: Path) -> list[dict]:
    runs = []
    for eval_dir in sorted(iteration_dir.iterdir()):
        if not eval_dir.is_dir():
            continue
        run_dir = eval_dir / "with_skill"
        if not run_dir.exists():
            continue
        run = load_run(run_dir)
        if run:
            runs.append(run)
        else:
            print(f"Warning: no grading.json in {run_dir}", file=sys.stderr)
    return runs


def aggregate(runs: list[dict]) -> dict:
    if not runs:
        return {"with_skill": {"pass_rate": stats([]), "time_seconds": stats([]), "tokens": stats([])}}
    return {
        "with_skill": {
            "pass_rate": stats([r["pass_rate"] for r in runs]),
            "time_seconds": stats([r["time_seconds"] for r in runs]),
            "tokens": stats([float(r["tokens"]) for r in runs]),
        }
    }


def generate_benchmark(runs: list[dict], skill_name: str, skill_path: str) -> dict:
    run_summary = aggregate(runs)
    eval_ids = sorted(set(r["eval_id"] for r in runs))

    return {
        "metadata": {
            "skill_name": skill_name,
            "skill_path": skill_path,
            "executor_model": "claude-sonnet-4-6",
            "analyzer_model": "claude-sonnet-4-6",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "evals_run": eval_ids,
            "runs_per_configuration": len([r for r in runs if r["configuration"] == "with_skill"]),
        },
        "runs": [
            {
                "eval_id": r["eval_id"],
                "eval_name": r["eval_name"],
                "configuration": r["configuration"],
                "run_number": 1,
                "result": {
                    "pass_rate": r["pass_rate"],
                    "passed": r["passed"],
                    "failed": r["failed"],
                    "total": r["total"],
                    "time_seconds": r["time_seconds"],
                    "tokens": r["tokens"],
                    "tool_calls": r["tool_calls"],
                    "errors": r["errors"],
                },
                "expectations": r["expectations"],
                "notes": r["notes"],
            }
            for r in runs
        ],
        "run_summary": run_summary,
        "notes": [],
    }


def generate_markdown(benchmark: dict) -> str:
    meta = benchmark["metadata"]
    rs = benchmark["run_summary"]

    ws = rs.get("with_skill", {})

    def fmt(d: dict, key: str, pct: bool = False) -> str:
        v = d.get(key, {})
        m, s = v.get("mean", 0), v.get("stddev", 0)
        if pct:
            return f"{m*100:.0f}% ± {s*100:.0f}%"
        return f"{m:.1f} ± {s:.1f}"

    lines = [
        f"# Benchmark: {meta['skill_name']}",
        "",
        f"**Date**: {meta['timestamp']}  **Model**: {meta['executor_model']}",
        f"**Evals**: {', '.join(map(str, meta['evals_run']))}",
        "",
        "## Summary",
        "",
        "| Metric | With Skill |",
        "|--------|-----------|",
        f"| Pass Rate | {fmt(ws, 'pass_rate', True)} |",
        f"| Time (s)  | {fmt(ws, 'time_seconds')} |",
        f"| Tokens    | {fmt(ws, 'tokens')} |",
        "",
        "## Per-eval results",
        "",
    ]

    for run in benchmark["runs"]:
        r = run["result"]
        lines.append(
            f"- **{run['eval_name']}** ({run['configuration']}): "
            f"{r['pass_rate']*100:.0f}% ({r['passed']}/{r['total']}) "
            f"— {r['time_seconds']:.0f}s"
        )

    if benchmark.get("notes"):
        lines += ["", "## Notes", ""]
        for note in benchmark["notes"]:
            lines.append(f"- {note}")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Aggregate gha-ci-audit eval results into benchmark.json")
    parser.add_argument("iteration_dir", type=Path)
    parser.add_argument("--skill-name", default="gha-ci-audit")
    parser.add_argument("--skill-path", default="skills/gha-ci-audit")
    parser.add_argument("--output", "-o", type=Path)
    args = parser.parse_args()

    if not args.iteration_dir.exists():
        print(f"Not found: {args.iteration_dir}", file=sys.stderr)
        sys.exit(1)

    runs = load_all(args.iteration_dir)
    if not runs:
        print("No graded runs found.", file=sys.stderr)
        sys.exit(1)

    benchmark = generate_benchmark(runs, args.skill_name, args.skill_path)

    out_json = args.output or (args.iteration_dir / "benchmark.json")
    out_md = out_json.with_suffix(".md")

    out_json.write_text(json.dumps(benchmark, indent=2))
    out_md.write_text(generate_markdown(benchmark))

    print(f"Generated: {out_json}")
    print(f"Generated: {out_md}")

    rs = benchmark["run_summary"]
    ws_pr = rs.get("with_skill", {}).get("pass_rate", {}).get("mean", 0)
    print(f"\nPass rate: {ws_pr*100:.1f}%")


if __name__ == "__main__":
    main()
