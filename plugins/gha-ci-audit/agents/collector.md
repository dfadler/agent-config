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

## Step 1: Run the collector script

```bash
bash {scripts_dir}/collect.sh \
  --repo {repo} \
  --output-dir {outputs_dir}
```

The script handles all 8 collection steps (workflows, run counts, runs, p50 run, jobs,
failure check, secondary stats, collect_summary) and writes `collect_timing.json`.

---

## Step 2: Handle ambiguous primary workflow (exit code 2 only)

Skip this step if `collect.sh` exited with code 0.

If `collect.sh` exits with code **2**, the primary CI workflow could not be auto-detected.
Read `{outputs_dir}/workflow_candidates.json` (a list of `{id, name, path}` objects).
Review each entry and select the workflow most likely to be the primary CI — it runs on
every PR push, is often named "CI", "Build", or "Test", and is triggered on
`pull_request`/`push` events.

Re-run with the chosen workflow ID:

```bash
bash {scripts_dir}/collect.sh \
  --repo {repo} \
  --output-dir {outputs_dir} \
  --workflow-id {chosen_id}
```

---

## Step 3: Verify outputs

After a successful run, confirm these files exist in `{outputs_dir}`:

| File | Purpose |
|------|---------|
| `workflows.json` | All active workflows |
| `runs.json` | Last 100 runs for the primary workflow |
| `jobs.json` | Jobs for the p50 representative run |
| `failure_check.txt` | Chronic-failure signal |
| `workflow_stats.txt` | Secondary workflow timing summary |
| `run_count_primary.txt` | 30-day run count |
| `p50_run.txt` | p50 run ID and duration |
| `collect_summary.json` | Rolled-up summary for the renderer |
| `collect_timing.json` | Wall-clock timing for this collection |

If `collect_timing.json` is missing (e.g. the script was interrupted before the final
timing step), note that timing data will be unavailable for this eval.

---

## Completion

Print a one-line summary (values come from `collect_summary.json`):

```
COLLECT OK: {repo}  primary={workflow_name} id={primary_id}  p50_run={p50_run_id}  runs_30d={count}
```

Do not produce any report, analysis, or HTML.
