#!/usr/bin/env python3
"""Capture render timing for the renderer agent.

Call with --start at the beginning of the render to record the start time,
then with --end at the end to compute duration and write render_timing.json.

Usage:
    python3 write_render_timing.py --start <outputs_dir>
    python3 write_render_timing.py --end   <outputs_dir>

Writes:
    --start: <outputs_dir>/.render_start  (ephemeral; removed by --end)
    --end:   <outputs_dir>/render_timing.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


MARKER_NAME = ".render_start"


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--start", "--end"):
        print(
            "Usage: write_render_timing.py --start|--end <outputs_dir>",
            file=sys.stderr,
        )
        sys.exit(1)

    mode = sys.argv[1]
    outputs_dir = Path(sys.argv[2])
    outputs_dir.mkdir(parents=True, exist_ok=True)
    marker = outputs_dir / MARKER_NAME

    if mode == "--start":
        now = datetime.now(timezone.utc)
        marker.write_text(
            json.dumps({
                "epoch": int(now.timestamp()),
                "iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
            })
        )
        print(f"Render timing started at {now.strftime('%Y-%m-%dT%H:%M:%SZ')}")
        return

    # --end
    if not marker.exists():
        print(
            f"Warning: {MARKER_NAME} not found in {outputs_dir}; skipping timing write.",
            file=sys.stderr,
        )
        sys.exit(0)

    start_data = json.loads(marker.read_text())
    start_epoch = start_data["epoch"]
    start_iso = start_data["iso"]

    now = datetime.now(timezone.utc)
    end_epoch = int(now.timestamp())
    end_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    duration = end_epoch - start_epoch

    timing = {
        "duration_seconds": duration,
        "start_iso": start_iso,
        "end_iso": end_iso,
    }

    out = outputs_dir / "render_timing.json"
    out.write_text(json.dumps(timing, indent=2) + "\n")
    marker.unlink(missing_ok=True)
    print(json.dumps(timing, indent=2))


if __name__ == "__main__":
    main()
