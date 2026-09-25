# Renderer Agent — gha-ci-audit

Produce `report.html` from already-collected data files. Reads `outputs/` only — no GitHub API calls.

This agent is the second half of the collector/renderer split. The collector fetched raw data; the renderer analyzes it and renders the report. If a combined eval agent was interrupted after data collection, spawn the renderer alone to recover without re-fetching.

## Inputs

- **outputs_dir**: absolute path to `<iter>/<eval_name>/with_skill/outputs/`
- **scripts_dir**: absolute path to `<plugin>/scripts/`
- **skill_path**: absolute path to `<plugin>/skills/gha-ci-audit/SKILL.md` — read it for the design system and pattern definitions

## What this agent does NOT do

- No `gh api` calls
- No data fetching of any kind
- If a required file is missing from `outputs/`, report which file is missing and stop — do not fetch it

---

## Step 1: Verify required data files exist

Check that these files are present in `{outputs_dir}`:

| File | Required |
|------|----------|
| `collect_summary.json` | Yes |
| `runs.json` | Yes |
| `jobs.json` | Yes |
| `failure_check.txt` | Yes |
| `workflow_stats.txt` | Yes |
| `workflows.json` | Yes |

If any required file is missing, stop and report: `MISSING: {filename} — re-run the collector for this eval.`

---

## Step 2: Run analysis scripts

Run the analysis scripts against the saved data. Read their output — this is the source of truth for all numbers in the report.

```bash
# Run timing analysis (by conclusion and by event)
python3 {scripts_dir}/analyze_runs.py {outputs_dir}/runs.json
python3 {scripts_dir}/analyze_runs.py {outputs_dir}/runs.json --group-by event

# Run job analysis with step breakdown
python3 {scripts_dir}/analyze_jobs.py {outputs_dir}/jobs.json
python3 {scripts_dir}/analyze_jobs.py {outputs_dir}/jobs.json --steps
```

Read `{outputs_dir}/collect_summary.json` for repo name, primary workflow name, p50 run ID, and 30-day run count.

Read `{outputs_dir}/failure_check.txt` to determine whether to show an alert-banner (look for `chronic=YES`).

Read `{outputs_dir}/workflow_stats.txt` for secondary workflow summary table.

---

## Step 3: Apply analysis patterns

Using the data from Step 2, work through the patterns defined in the skill (Steps 6 in `SKILL.md`):

- **Pre-check**: `failure_check.txt` says `chronic=YES` → include alert-banner
- **Pattern A**: Long-tail critical path bottleneck
- **Pattern B**: Failures cost as much as successes
- **Pattern C**: Expensive cancellations
- **Pattern D**: Wide duration variance / bimodal distribution
- **Pattern E**: High secondary workflow volume with waste
- **Pattern F**: Cross-workflow correlated failures (caveats only)
- **After patterns**: What's already working well

Rank the applicable patterns by estimated monthly impact (job-minutes saved or failure rate reduced). Only include patterns with actual evidence from the data.

---

## Step 4: Render report.html

Read the design system from `SKILL.md` Step 7. Use it exactly — same CSS tokens, same component markup, same font stack. The content (repo name, numbers, opportunity text) is what changes.

Write the complete report to `{outputs_dir}/report.html`.

Every number in the report must trace back to a script output or a file in `outputs/`. If a number cannot be sourced, do not include it.

---

## Completion

Print a one-line summary:

```
RENDER OK: {owner}/{repo}  opportunities={N}  alert_banner={yes/no}  report={outputs_dir}/report.html
```
