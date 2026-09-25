#!/usr/bin/env python3
"""Write collect_timing.json with wall-clock duration data.

Called by collect.sh after all collection steps complete.

Usage:
    python3 write_collect_timing.py <outputs_dir> <duration_seconds> <start_iso> <end_iso>

Writes: <outputs_dir>/collect_timing.json
"""

import json
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 5:
        print(
            "Usage: write_collect_timing.py <outputs_dir> <duration_seconds> <start_iso> <end_iso>",
            file=sys.stderr,
        )
        sys.exit(1)

    outputs_dir = Path(sys.argv[1])
    duration = int(sys.argv[2])
    start_iso = sys.argv[3]
    end_iso = sys.argv[4]

    timing = {
        "duration_seconds": duration,
        "start_iso": start_iso,
        "end_iso": end_iso,
    }

    out = outputs_dir / "collect_timing.json"
    out.write_text(json.dumps(timing, indent=2) + "\n")
    print(json.dumps(timing, indent=2))


if __name__ == "__main__":
    main()
