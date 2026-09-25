#!/usr/bin/env python3
"""Populate assertions from evals.json into each eval's eval_metadata.json.

Usage:
    python3 write_assertions.py <iter_dir> <evals_json>

Arguments:
    iter_dir    Path to the iteration directory (e.g. .../iteration-5)
    evals_json  Path to evals/evals.json

Reads the assertions for each eval from evals_json and writes them into
<iter_dir>/<eval_name>/with_skill/eval_metadata.json.

Prints one line per eval: "Populated <name>: N assertions"
"""

import json
import sys
from pathlib import Path

NAME_MAP = {1: "vite-audit", 2: "agent-config-context", 3: "facebook-react"}


def main():
    if len(sys.argv) != 3:
        print("Usage: write_assertions.py <iter_dir> <evals_json>", file=sys.stderr)
        sys.exit(1)

    iter_dir = Path(sys.argv[1])
    evals_json = Path(sys.argv[2])

    evals = json.loads(evals_json.read_text())

    for ev in evals["evals"]:
        name = NAME_MAP.get(ev["id"])
        if not name:
            print(f"Unknown eval id {ev['id']}, skipping", file=sys.stderr)
            continue

        meta_path = iter_dir / name / "with_skill" / "eval_metadata.json"
        if not meta_path.exists():
            print(f"Missing {meta_path}, skipping", file=sys.stderr)
            continue

        meta = json.loads(meta_path.read_text())
        meta["assertions"] = ev.get("assertions", [])
        meta_path.write_text(json.dumps(meta, indent=2) + "\n")
        print(f"Populated {name}: {len(meta['assertions'])} assertions")


if __name__ == "__main__":
    main()
