#!/usr/bin/env python3
"""Wall-clock timing capture for gha-ci-audit pipeline stages.

Collapses the previously-duplicated write_collect_timing.py and
write_render_timing.py (issue #368) into one shared start()/end() pair, so
both the collect side and the render side write the same
`{duration_seconds, start_iso, end_iso}` shape from one implementation.

In-process callers (e.g. gha_ci_audit_collect.py, which runs a full collect
iteration in one Python process) use start()/end()/write() directly:

    t0 = timing.start()
    ...
    timing.write(outputs_dir / "collect_timing.json", timing.end(t0))

Cross-process callers whose start and end happen in separate invocations
(e.g. the renderer agent, whose "start" and "end" are two separate tool
calls, possibly minutes apart) use the CLI below, which persists the start
marker to a file between calls:

    python3 timing.py --start <outputs_dir>   # writes <outputs_dir>/.render_start
    ... (rendering happens) ...
    python3 timing.py --end <outputs_dir>     # writes <outputs_dir>/render_timing.json
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MARKER_NAME = ".render_start"


def start() -> dict[str, Any]:
    """Capture the current time as a start marker: {epoch, iso}."""
    now = datetime.now(timezone.utc)
    return {"epoch": int(now.timestamp()), "iso": now.strftime("%Y-%m-%dT%H:%M:%SZ")}


def end(start_data: dict[str, Any]) -> dict[str, Any]:
    """Compute {duration_seconds, start_iso, end_iso} from a start() marker."""
    now = datetime.now(timezone.utc)
    end_epoch = int(now.timestamp())
    return {
        "duration_seconds": end_epoch - int(start_data["epoch"]),
        "start_iso": start_data["iso"],
        "end_iso": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def write(path: Path, timing: dict[str, Any]) -> None:
    """Write a timing dict as indented JSON with a trailing newline, and echo it."""
    path.write_text(json.dumps(timing, indent=2) + "\n")
    print(json.dumps(timing, indent=2))


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--start", "--end"):
        print("Usage: timing.py --start|--end <outputs_dir>", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    outputs_dir = Path(sys.argv[2])
    outputs_dir.mkdir(parents=True, exist_ok=True)
    marker = outputs_dir / MARKER_NAME

    if mode == "--start":
        data = start()
        marker.write_text(json.dumps(data))
        print(f"Render timing started at {data['iso']}")
        return

    # --end
    if not marker.exists():
        print(
            f"Warning: {MARKER_NAME} not found in {outputs_dir}; skipping timing write.",
            file=sys.stderr,
        )
        sys.exit(0)

    start_data = json.loads(marker.read_text())
    write(outputs_dir / "render_timing.json", end(start_data))
    marker.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
