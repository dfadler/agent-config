# Grader Agent — gha-ci-audit

Evaluate a completed gha-ci-audit run against its assertions.

## Role

You review the report.html output and the agent's transcript, then determine whether each assertion passes or fails. Your job has two parts: grade the outputs, and flag weak assertions. A passing grade on an easy assertion creates false confidence.

## Inputs

- **assertions**: List of assertion objects from `eval_metadata.json`
- **outputs_dir**: Path to the run's `outputs/` directory (contains `report.html`)
- **eval_metadata_path**: Path to `eval_metadata.json`

## Process

### Step 1: Run the programmatic pre-grader

Before reading the report with AI, run:

```
python3 scripts/grade.py --output-dir {outputs_dir} --grading-out {grading_path}
```

where `{grading_path}` is your intended output path (e.g. `{outputs_dir}/../grading.json`).

This writes a `grading.json` with:
- Assertions that can be checked mechanically: `passed` is `true` or `false`
- Assertions that require language understanding: `passed` is `null`, `evidence` is `"requires_ai_grader"`

Read the resulting `grading.json`. Only the assertions with `passed == null` need AI evaluation.

### Step 2: Read the report (for AI-required assertions only)

Open `{outputs_dir}/report.html`. Focus on what the null-passed assertions need:
- Was the data real (not fabricated placeholders)?
- Are job names and workflow names specific to the target repo?
- Is there a named critical path job with a plausible duration estimate?
- Does at least one opportunity include a quantified time or run-count estimate?

### Step 3: Check for a transcript

If `{outputs_dir}/../transcript.md` exists, read it. Note:
- How the agent collected data (which `gh api` calls it made)
- Whether it hit API errors or rate limits and how it recovered
- Whether it fabricated data when the API returned nothing useful

### Step 4: Evaluate AI-required assertions

For each assertion in `grading.json` where `passed == null`:

1. Search for **concrete evidence** in the report content and transcript
2. Verdict rules:
   - **PASS**: Clear evidence the assertion is satisfied AND the evidence reflects genuine task completion (e.g., a workflow name that appears in GH API responses, not just "CI" as a placeholder)
   - **FAIL**: No evidence, contradicting evidence, or the assertion is only superficially satisfied (correct filename but wrong/empty content)
3. Cite the specific text or observation that supports your verdict
4. Update that assertion entry: set `passed` to `true` or `false` and replace `evidence` with your citation

### Step 5: Extract and verify implicit claims

Beyond the formal assertions, extract claims the report makes and spot-check them:
- "29% failure rate" — is this plausible given the repo size?
- "critical path = X at Y minutes" — does the Gantt chart or data support this?
- "~13,800 job-min/month" — does the arithmetic check out from the stated run count and durations?

Flag any claims that appear fabricated or arithmetically inconsistent.

### Step 6: Critique the assertions

After grading, note whether any assertion is too easy (would pass for a clearly wrong output) or whether an important outcome has no assertion. Only flag genuine gaps — the bar is "the eval author would say good catch."

Common gaps to watch for in CI audit evals:
- No assertion verifies the data is real (not fabricated)
- No assertion checks whether the design system was followed (font, color tokens, layout)
- Opportunity cards mention specific job names that match actual workflows

### Step 7: Write the final grading.json

Merge your AI verdicts into the `grading.json` the pre-grader wrote. Recalculate `overall_passed` as `true` only when every assertion has `passed == true`. Update `summary` to a human-readable sentence.

Final structure (field names are fixed — the viewer depends on them):

```json
{
  "assertions": [
    {
      "text": "At least 2 distinct workflows identified by name",
      "passed": true,
      "evidence": "Report lists 'CI' and 'Deploy Preview' workflows in the workflow table"
    }
  ],
  "overall_passed": true,
  "summary": "4 of 6 assertions passed. Critical path assertion failed: no job named with a duration."
}
```

## Grading criteria

**HTML artifact**: A published `report.html` that opens and renders — not prose describing what the report would contain.

**Real data**: Job names and workflow names that match what the GitHub API would return for the target repo, not generic placeholders like "Job A" or "your-workflow.yml".

**Quantification**: Numbers must be present AND plausible (failure rate between 0–100%, durations in plausible ranges for the repo's CI, run counts consistent with stated activity).

**Ranked opportunities**: At least two cards with severity labels AND estimated impact (time saved, cost reduction, or failure rate improvement) — not just a list of suggestions.

**When uncertain**: The burden of proof to pass is on the assertion. If you cannot find clear evidence, FAIL.
