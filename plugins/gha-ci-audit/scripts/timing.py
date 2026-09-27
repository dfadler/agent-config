#!/usr/bin/env python3
"""Shared wall-clock timing helpers for gha-ci-audit's collect and render phases.

`start()`/`end()` are the pure functions both phases share — they replace the
identical `{duration_seconds, start_iso, end_iso}` shape that used to be
implemented twice (`write_collect_timing.py` and `write_render_timing.py`).

The collect phase runs start-to-end inside a single process (see
`collect_pipeline.py`), so it calls `start()`/`end()` directly and writes
`collect_timing.json` itself.

The render phase spans two separate agent turns (Step 0 and the final step of
a much longer render), so it needs the marker persisted to disk between them.
This module's CLI (`--start`/`--end <outputs_dir>`) is that persistence layer,
kept as a script because `agents/renderer.md` invokes it as a CLI step, not
an import — same contract `write_render_timing.py` used to provide, just
under a shared name.

Usage:
    python3 timing.py --start <outputs_dir>
    python3 timing.py --end   <outputs_dir>

Writes:
    --start: <outputs_dir>/.render_start  (ephemeral; removed by --end)
    --end:   <outputs_dir>/render_timing.json
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

MARKER_NAME = ".render_start"


@dataclass(frozen=True)
class Marker:
    """A captured point in time, JSON-serializable via `to_dict`/`from_dict`."""

    epoch: int
    iso: str

    def to_dict(self) -> dict[str, Any]:
        return {"epoch": self.epoch, "iso": self.iso}

    @staticmethod
    def from_dict(data: dict[str, Any]) -> "Marker":
        return Marker(epoch=int(data["epoch"]), iso=str(data["iso"]))


@dataclass(frozen=True)
class TimingResult:
    duration_seconds: int
    start_iso: str
    end_iso: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "duration_seconds": self.duration_seconds,
            "start_iso": self.start_iso,
            "end_iso": self.end_iso,
        }


def start() -> Marker:
    """Capture the current instant as a `Marker`."""
    now = datetime.now(timezone.utc)
    return Marker(epoch=int(now.timestamp()), iso=now.strftime("%Y-%m-%dT%H:%M:%SZ"))


def end(marker: Marker) -> TimingResult:
    """Compute the duration from a previously captured `Marker` to now."""
    now_marker = start()
    return TimingResult(
        duration_seconds=now_marker.epoch - marker.epoch,
        start_iso=marker.iso,
        end_iso=now_marker.iso,
    )


# ---------------------------------------------------------------------------
# CLI — file-marker persistence for the render phase (see module docstring)
# ---------------------------------------------------------------------------


def cli_start(outputs_dir: Path) -> None:
    outputs_dir.mkdir(parents=True, exist_ok=True)
    marker = start()
    (outputs_dir / MARKER_NAME).write_text(json.dumps(marker.to_dict()))
    print(f"Render timing started at {marker.iso}")


def cli_end(outputs_dir: Path) -> None:
    marker_path = outputs_dir / MARKER_NAME
    if not marker_path.exists():
        print(
            f"Warning: {MARKER_NAME} not found in {outputs_dir}; skipping timing write.",
            file=sys.stderr,
        )
        sys.exit(0)

    marker = Marker.from_dict(json.loads(marker_path.read_text()))
    result = end(marker)

    out = outputs_dir / "render_timing.json"
    out.write_text(json.dumps(result.to_dict(), indent=2) + "\n")
    marker_path.unlink(missing_ok=True)
    print(json.dumps(result.to_dict(), indent=2))


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in ("--start", "--end"):
        print("Usage: timing.py --start|--end <outputs_dir>", file=sys.stderr)
        sys.exit(1)

    mode = sys.argv[1]
    outputs_dir = Path(sys.argv[2])

    if mode == "--start":
        cli_start(outputs_dir)
    else:
        cli_end(outputs_dir)


if __name__ == "__main__":
    main()
