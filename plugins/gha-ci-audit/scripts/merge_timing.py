#!/usr/bin/env python3
"""Merge collect_timing.json and render_timing.json into timing.json.

Reads both timing files from outputs/ and writes a combined timing.json
one level up (the eval root, e.g. with_skill/).

Usage:
    python3 merge_timing.py <outputs_dir>

Writes: <outputs_dir>/../timing.json

Fields in timing.json:
    collect_duration_seconds  int or null
    render_duration_seconds   int or null
    total_duration_seconds    int or null
    collect_start_iso         str or null
    collect_end_iso           str or null
    render_start_iso          str or null
    render_end_iso            str or null
"""

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: merge_timing.py <outputs_dir>", file=sys.stderr)
        sys.exit(1)

    outputs_dir = Path(sys.argv[1])
    eval_root = outputs_dir.parent  # one level up: e.g. with_skill/

    collect_path = outputs_dir / "collect_timing.json"
    render_path = outputs_dir / "render_timing.json"

    if not collect_path.exists() and not render_path.exists():
        print(
            f"No timing files found in {outputs_dir}. "
            "Expected collect_timing.json and/or render_timing.json.",
            file=sys.stderr,
        )
        sys.exit(1)

    collect_timing = json.loads(collect_path.read_text()) if collect_path.exists() else None
    render_timing = json.loads(render_path.read_text()) if render_path.exists() else None

    collect_dur = collect_timing["duration_seconds"] if collect_timing else None
    render_dur = render_timing["duration_seconds"] if render_timing else None

    if collect_dur is not None and render_dur is not None:
        total_dur = collect_dur + render_dur
    elif collect_dur is not None:
        total_dur = collect_dur
    elif render_dur is not None:
        total_dur = render_dur
    else:
        total_dur = None

    timing: dict = {
        "collect_duration_seconds": collect_dur,
        "render_duration_seconds": render_dur,
        "total_duration_seconds": total_dur,
        "collect_start_iso": collect_timing.get("start_iso") if collect_timing else None,
        "collect_end_iso": collect_timing.get("end_iso") if collect_timing else None,
        "render_start_iso": render_timing.get("start_iso") if render_timing else None,
        "render_end_iso": render_timing.get("end_iso") if render_timing else None,
    }

    out = eval_root / "timing.json"
    out.write_text(json.dumps(timing, indent=2) + "\n")
    print(json.dumps(timing, indent=2))
    print(f"Written to {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
