#!/usr/bin/env python3
"""
grade.py — Programmatic pre-grader for gha-ci-audit evals.

Handles grep/file-check assertions without LLM tokens.
Assertions that require language understanding get passed=null and
evidence="requires_ai_grader" so the grader agent can fill them in.

Usage:
    python3 scripts/grade.py --output-dir <path/to/outputs> \
                              --grading-out <path/to/grading.json>
"""

import argparse
import json
import os
import re


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def _file_nonempty(path: str, min_bytes: int = 1) -> bool:
    try:
        return os.path.getsize(path) >= min_bytes
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Per-assertion checks
# ---------------------------------------------------------------------------

def check_artifact_published(outputs_dir: str) -> tuple[bool | None, str]:
    report = os.path.join(outputs_dir, "report.html")
    if not os.path.exists(report):
        return False, "report.html not found in outputs directory"
    size = os.path.getsize(report)
    if size < 1000:
        return False, f"report.html exists but is only {size} bytes (< 1000)"
    return True, f"report.html exists and is {size} bytes"


def check_workflow_count_found(outputs_dir: str) -> tuple[bool | None, str]:
    # Try workflows.json first
    wf_path = os.path.join(outputs_dir, "workflows.json")
    wf_text = _read_text(wf_path)
    if wf_text:
        try:
            data = json.loads(wf_text)
            count = len(data) if isinstance(data, list) else 0
            if count >= 2:
                return True, f"workflows.json contains {count} entries"
            if count == 1:
                return False, f"workflows.json contains only {count} entry (need >= 2)"
        except json.JSONDecodeError:
            pass

    # Fall back to grepping report.html for table rows with workflow names
    report = _read_text(os.path.join(outputs_dir, "report.html"))
    if not report:
        return False, "Neither workflows.json nor report.html found"

    # Look for <tr> elements that likely represent workflow rows (td tags with a name)
    workflow_row_pattern = re.compile(
        r"<tr[^>]*>.*?<td[^>]*>[^<]{3,}</td>", re.IGNORECASE | re.DOTALL
    )
    rows = workflow_row_pattern.findall(report)
    if len(rows) >= 2:
        return True, f"report.html contains {len(rows)} table rows (likely workflow entries)"

    return False, "Could not confirm 2+ workflows in workflows.json or report.html"


def check_failure_rate(outputs_dir: str) -> tuple[bool | None, str]:
    report = _read_text(os.path.join(outputs_dir, "report.html"))
    if not report:
        return False, "report.html not found"

    # Look for a percentage within ~200 chars of the word "failure" or "fail"
    # Also accept a decimal like 0.12 near "failure"
    pattern = re.compile(
        r"fail(?:ure)?[^<]{0,200}?(\d{1,3}(?:\.\d+)?%|\b0\.\d{2,})\b"
        r"|(\d{1,3}(?:\.\d+)?%|\b0\.\d{2,})\b[^<]{0,200}?fail(?:ure)?",
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(report)
    if match:
        value = match.group(1) or match.group(2)
        return True, f"Failure rate value found in report.html: '{value}'"

    # Broader: any % near "fail" in text stripped of tags
    stripped = re.sub(r"<[^>]+>", " ", report)
    broad = re.compile(
        r"fail(?:ure)?[^.]{0,100}?\d{1,3}(?:\.\d+)?%"
        r"|\d{1,3}(?:\.\d+)?%[^.]{0,100}?fail(?:ure)?",
        re.IGNORECASE,
    )
    match2 = broad.search(stripped)
    if match2:
        snippet = match2.group(0)[:80].strip()
        return True, f"Failure-rate pattern found in report text: '{snippet}'"

    return False, "No failure rate (% near 'failure') found in report.html"


def check_ranked_opportunities(outputs_dir: str) -> tuple[bool | None, str]:
    report = _read_text(os.path.join(outputs_dir, "report.html"))
    if not report:
        return False, "report.html not found"

    high = len(re.findall(r'sev-high', report, re.IGNORECASE))
    med = len(re.findall(r'sev-med', report, re.IGNORECASE))
    total = high + med
    if total >= 2:
        return True, f"Found {high} sev-high and {med} sev-med badges in report.html"
    if total == 1:
        return False, f"Only {total} severity badge found (need >= 2)"

    # Fallback: look for opportunity card patterns without the CSS class
    card_pattern = re.compile(
        r'(?:opportunity|recommendation|suggestion)[^<]{0,300}?'
        r'(?:high|medium|low|critical)[^<]{0,300}?(?:save|reduce|improve)',
        re.IGNORECASE | re.DOTALL,
    )
    cards = card_pattern.findall(report)
    if len(cards) >= 2:
        return True, f"Found {len(cards)} opportunity cards in report.html (no sev-* badges)"

    return False, "Could not find 2+ ranked opportunity cards (sev-high/sev-med) in report.html"


def check_data_files_saved(outputs_dir: str) -> tuple[bool | None, str]:
    runs = os.path.join(outputs_dir, "runs.json")
    jobs = os.path.join(outputs_dir, "jobs.json")
    missing = []
    if not _file_nonempty(runs, 2):
        missing.append("runs.json")
    if not _file_nonempty(jobs, 2):
        missing.append("jobs.json")
    if missing:
        return False, f"Missing or empty: {', '.join(missing)}"
    return (
        True,
        f"runs.json ({os.path.getsize(runs)} bytes) and "
        f"jobs.json ({os.path.getsize(jobs)} bytes) both exist",
    )


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

# Assertion IDs handled programmatically
PROGRAMMATIC_IDS = {
    "artifact_published",
    "workflow_count_found",
    "failure_rate_computed",
    "failure_rate_quantified",
    "ranked_opportunities",
    "data_files_saved",
}


def grade_assertion(assertion_id: str, assertion_text: str, outputs_dir: str) -> dict:
    """Return a grading dict for one assertion."""
    if assertion_id == "artifact_published":
        passed, evidence = check_artifact_published(outputs_dir)
    elif assertion_id == "workflow_count_found":
        passed, evidence = check_workflow_count_found(outputs_dir)
    elif assertion_id in ("failure_rate_computed", "failure_rate_quantified"):
        passed, evidence = check_failure_rate(outputs_dir)
    elif assertion_id == "ranked_opportunities":
        passed, evidence = check_ranked_opportunities(outputs_dir)
    elif assertion_id == "data_files_saved":
        passed, evidence = check_data_files_saved(outputs_dir)
    else:
        # Requires AI grader
        passed = None
        evidence = "requires_ai_grader"

    return {"text": assertion_text, "passed": passed, "evidence": evidence}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Programmatic pre-grader for gha-ci-audit evals"
    )
    parser.add_argument(
        "--output-dir", required=True, help="Path to the run's outputs/ directory"
    )
    parser.add_argument(
        "--grading-out", required=True, help="Path where grading.json should be written"
    )
    args = parser.parse_args()

    outputs_dir = os.path.abspath(args.output_dir)
    grading_out = os.path.abspath(args.grading_out)

    # Locate evals.json: scripts/ → ../evals/evals.json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    evals_path = os.path.join(script_dir, "..", "evals", "evals.json")
    with open(evals_path, encoding="utf-8") as f:
        evals_data = json.load(f)

    # Read eval_metadata.json from parent of outputs_dir to find eval_id
    run_dir = os.path.dirname(outputs_dir)
    metadata_path = os.path.join(run_dir, "eval_metadata.json")

    eval_id: int | None = None
    if os.path.exists(metadata_path):
        with open(metadata_path, encoding="utf-8") as f:
            meta = json.load(f)
        eval_id = meta.get("eval_id")

    # Find the matching eval; fall back to eval 1 if metadata is absent
    all_evals = evals_data.get("evals", [{}])
    eval_entry = next(
        (e for e in all_evals if e.get("id") == eval_id),
        all_evals[0],
    )
    assertions_spec = eval_entry.get("assertions", [])

    # Grade each assertion
    graded = []
    for spec in assertions_spec:
        result = grade_assertion(spec["id"], spec["text"], outputs_dir)
        graded.append(result)

    # Build summary (only counting decided entries — nulls are filled by AI later)
    decided = [a for a in graded if a["passed"] is not None]
    passed_count = sum(1 for a in decided if a["passed"])
    failed_count = sum(1 for a in decided if not a["passed"])
    ai_count = len(graded) - len(decided)

    output = {
        "assertions": graded,
        # overall_passed remains null until the AI grader resolves all null entries
        "overall_passed": None,
        "summary": (
            f"{passed_count} passed, {failed_count} failed programmatically; "
            f"{ai_count} require AI grading"
        ),
    }

    out_parent = os.path.dirname(grading_out)
    if out_parent:
        os.makedirs(out_parent, exist_ok=True)
    with open(grading_out, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(
        f"grade.py: wrote {grading_out} — "
        f"{passed_count} passed, {failed_count} failed, {ai_count} deferred to AI"
    )


if __name__ == "__main__":
    main()
