#!/usr/bin/env python3
"""Detect the primary CI workflow from a list of active workflows.

Checks each workflow's recent runs for push/pull_request events.
Primary = triggered by push or pull_request events against the default branch.

Usage:
    python3 detect_primary_workflow.py <workflows.json> <repo> <candidates_json>

Side effects:
    - On exactly one match: writes <workflows_dir>/primary_workflow_id.txt, exits 0
    - On multiple matches: writes <candidates_json>, exits 2
    - On no match: defaults to first active workflow, exits 0 with a warning

The caller (collect.sh) reads primary_workflow_id.txt on exit 0,
or workflow_candidates.json on exit 2 so the orchestrator can invoke
the collector agent with --workflow-id for AI disambiguation.
"""

import json
import subprocess
import sys
from pathlib import Path


def get_workflow_events(repo: str, workflow_id: int) -> set:
    """Return the set of distinct event types seen in the last 10 runs."""
    try:
        result = subprocess.run(
            [
                "gh", "api",
                f"repos/{repo}/actions/workflows/{workflow_id}/runs?per_page=10",
                "--jq", "[.workflow_runs[].event] | unique",
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        events = json.loads(result.stdout.strip() or "[]")
        return set(events)
    except Exception:
        return set()


def main() -> None:
    if len(sys.argv) != 4:
        print(
            "Usage: detect_primary_workflow.py <workflows.json> <repo> <candidates_json>",
            file=sys.stderr,
        )
        sys.exit(1)

    workflows_path = Path(sys.argv[1])
    repo = sys.argv[2]
    candidates_path = Path(sys.argv[3])

    workflows = json.loads(workflows_path.read_text())

    primary_candidates = []
    for wf in workflows:
        events = get_workflow_events(repo, wf["id"])
        if "push" in events or "pull_request" in events:
            primary_candidates.append(wf)

    if len(primary_candidates) == 1:
        wf = primary_candidates[0]
        id_file = workflows_path.parent / "primary_workflow_id.txt"
        id_file.write_text(str(wf["id"]))
        print(f"Detected primary workflow: {wf['name']} (id={wf['id']})")
        sys.exit(0)

    if len(primary_candidates) > 1:
        candidates_path.write_text(json.dumps(primary_candidates, indent=2) + "\n")
        names = [w["name"] for w in primary_candidates]
        print(
            f"Ambiguous: {len(primary_candidates)} workflows match push/pull_request: {names}",
            file=sys.stderr,
        )
        sys.exit(2)

    # No match — fall back to the first active workflow with a warning
    if workflows:
        wf = workflows[0]
        id_file = workflows_path.parent / "primary_workflow_id.txt"
        id_file.write_text(str(wf["id"]))
        print(
            f"Warning: no push/pull_request triggers found; "
            f"defaulting to first active workflow: {wf['name']} (id={wf['id']})",
            file=sys.stderr,
        )
        print(f"Defaulting to: {wf['name']} (id={wf['id']})")
        sys.exit(0)

    print("No active workflows found.", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
