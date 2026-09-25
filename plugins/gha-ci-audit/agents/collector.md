# Collector Agent — gha-ci-audit

Fetch all raw GitHub Actions data for one eval. Produces data files in `outputs/` only — no report, no analysis prose.

The renderer agent reads these files to produce `report.html`. Keeping data collection separate means a killed or failed agent loses only the cheap-to-re-run fetch step, not the expensive render.

## Inputs

- **repo**: `owner/repo` (e.g. `vitejs/vite`)
- **outputs_dir**: absolute path to `<iter>/<eval_name>/with_skill/outputs/`
- **scripts_dir**: absolute path to `<plugin>/scripts/`

## What this agent does NOT do

- No analysis prose
- No report.html
- No opportunity cards
- No design system markup

If you find yourself writing HTML or interpreting findings, stop — that belongs in the renderer.

---

## Step 1: Discover workflows

```bash
gh api repos/{owner}/{repo}/actions/workflows \
  --jq '[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)'
```

Save the output to `{outputs_dir}/workflows.json`.

Identify the **primary CI workflow** (runs on every PR push — named "CI", "Build", "Test", triggered on `pull_request`/`push`). Note its `id`. All others are secondary.

---

## Step 2: Fetch run counts (30-day)

For the primary workflow:

```bash
gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=1&created>=$(date -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d '30 days ago' --iso-8601=seconds)" \
  --jq '.total_count'
```

Save the count to `{outputs_dir}/run_count_primary.txt`.

---

## Step 3: Fetch primary workflow runs

```bash
gh api "repos/{owner}/{repo}/actions/workflows/{primary_id}/runs?per_page=100" \
  > {outputs_dir}/runs.json
```

---

## Step 4: Find the p50 representative run

```bash
python3 {scripts_dir}/find_p50_run.py {outputs_dir}/runs.json
```

Save the full output line (run_id + duration + created_at) to `{outputs_dir}/p50_run.txt`. The first token is the run ID.

---

## Step 5: Fetch jobs for the p50 run

```bash
P50_RUN_ID=$(awk '{print $1}' {outputs_dir}/p50_run.txt)
gh api "repos/{owner}/{repo}/actions/runs/${P50_RUN_ID}/jobs?per_page=100" \
  > {outputs_dir}/jobs.json
```

---

## Step 6: Check for chronic failures

```bash
python3 {scripts_dir}/check_failures.py {outputs_dir}/runs.json \
  > {outputs_dir}/failure_check.txt 2>&1
echo "exit_code=$?" >> {outputs_dir}/failure_check.txt
```

---

## Step 7: Fetch secondary workflow stats

```bash
# Extract secondary workflow IDs (all except primary)
SECONDARY_IDS=$(python3 -c "
import json
wfs = json.load(open('{outputs_dir}/workflows.json'))
primary_id = {primary_id}
ids = [str(w['id']) for w in wfs if w['id'] != primary_id]
print(' '.join(ids))
")

bash {scripts_dir}/fetch_workflow_stats.sh {owner}/{repo} $SECONDARY_IDS \
  > {outputs_dir}/workflow_stats.txt 2>&1
```

If there are no secondary workflows, write `no secondary workflows` to `workflow_stats.txt`.

---

## Step 8: Write collect_summary.json

```bash
python3 {scripts_dir}/write_collect_summary.py \
  {outputs_dir} \
  {owner}/{repo} \
  {primary_workflow_id} \
  "{primary_workflow_name}" \
  {p50_run_id} \
  {p50_duration_min} \
  {run_count_30d}
```

All values come from earlier steps — `primary_workflow_id` and `primary_workflow_name` from Step 1, `p50_run_id` and `p50_duration_min` from Step 4 (`p50_run.txt`), `run_count_30d` from Step 2 (`run_count_primary.txt`). Never write inline Python to build this file.

---

## Completion

When all 8 steps are done, print a one-line summary:

```
COLLECT OK: {owner}/{repo}  primary={workflow_name} id={primary_id}  p50_run={p50_run_id}  runs_30d={count}
```

Do not produce any report, analysis, or HTML.
