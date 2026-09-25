---
name: gha-ci-audit
description: >
  Audit GitHub Actions usage for a repository and surface ranked cost and performance improvement opportunities. Use this skill whenever the user asks about CI costs, CI performance, GitHub Actions usage, pipeline speed, slow builds, expensive workflows, runner minutes, or wants to understand what's bottlenecking or costing the most in their CI. Trigger on phrases like "audit our CI", "what's costing us in Actions", "why is CI slow", "analyze our pipeline", "GitHub Actions usage", "optimize CI", "reduce CI costs", "what's on the critical path", or any question about improving build/test pipeline efficiency.
---

# GitHub Actions CI Audit

Collect workflow run data from the GitHub API, find patterns that cost time or money, and deliver a ranked, quantified set of improvement opportunities as a published Artifact.

> **For eval orchestrators**: The canonical eval workflow, grader/analyzer agent instructions, and reusable scripts live alongside this skill:
> - `agents/orchestrator.md` — **run a full iteration in one agent call** (setup → collect → render → grade → aggregate → viewer → propose improvements). Start here.
> - `references/eval-workflow.md` — conceptual overview of the phases (use if orchestrator is unavailable)
> - `agents/collector.md` — fetch raw GitHub API data for one eval (runs.json, jobs.json, workflow stats)
> - `agents/renderer.md` — produce report.html from already-collected data files (no API calls)
> - `agents/grader.md` — how to grade report.html outputs against assertions
> - `agents/analyzer.md` — how to analyze benchmark patterns after grading
> - `agents/skill-improver.md` — propose targeted SKILL.md edits based on grading evidence
> - `scripts/setup_eval.sh` — create iteration directories
> - `scripts/check_status.py` — see what's done and what's missing
> - `scripts/aggregate.py` — produce benchmark.json from grading results
> - `scripts/launch_viewer.sh` — start the eval viewer

> **Bundled analysis scripts** — **never write inline Python or ad-hoc shell analysis. Always call these scripts.** Every data-analysis step in this skill has a corresponding script; if you find yourself writing `python3 -c "..."` or a custom bash loop, stop and use the matching script instead.
> - `scripts/analyze_runs.py` — duration stats + conclusion/event breakdown from runs JSON
> - `scripts/analyze_jobs.py` — critical path, billable minutes, top jobs, optional step breakdown
> - `scripts/fetch_workflow_stats.sh` — counts + avg/p90 for multiple workflow IDs in one pass
> - `scripts/find_p50_run.py` — print the run ID of the successful run closest to median duration (use before analyze_jobs.py)
> - `scripts/check_failures.py` — detect chronic failure patterns; exits 1 if failure rate >40% or streak ≥5 (use in Step 6 pre-check)
> - `scripts/write_collect_summary.py` — write collect_summary.json from CLI args (use in collector Step 8; never build this JSON inline)
> - `scripts/write_assertions.py` — populate assertions from evals.json into eval_metadata.json (use in orchestrator Step 2; never use a heredoc or inline Python for this)
> - `scripts/compute_workflow_timing.py` — read workflow runs JSON from stdin, output avg and p90 duration in minutes (used internally by fetch_workflow_stats.sh)

## Step 1: Identify the repository

If the user named a repo (e.g. `owner/repo`), use that. Otherwise:

```bash
gh repo view --json nameWithOwner --jq '.nameWithOwner'
```

Confirm with the user if ambiguous.

## Step 2: Discover workflows

List all active workflows and note their IDs and names:

```bash
gh api repos/{owner}/{repo}/actions/workflows \
  --jq '[.workflows[] | select(.state == "active") | {id, name, path}] | sort_by(.name)'
```

Identify the **primary CI workflow** — the one that runs on every PR push. Signs: named "CI", "Build", "Pipeline", "Test", triggered on `pull_request`/`push`. You can confirm by checking the workflow file:

```bash
gh api repos/{owner}/{repo}/contents/.github/workflows/{filename} \
  --jq '.content' | base64 -d | head -20
```

If there are multiple candidates, pick the one with the most runs (see Step 3). Note all other workflows too — secondary workflows (deploy, cleanup, labeler) are worth auditing even if not the primary focus.

## Step 3: Get true run counts (last 30 days)

For the primary CI workflow:

```bash
gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=1&created=>$(date -v-30d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d '30 days ago' --iso-8601=seconds)" \
  --jq '.total_count'
```

> The `created>` filter uses ISO 8601. On macOS use `date -v-30d`; on Linux use `date -d '30 days ago'`. If the date flag errors, fall back to omitting the filter and noting the caveat.

For each other workflow, get counts the same way. This gives you the true volume — don't rely on paginating through runs (you'd hit the 500-run API cap before seeing 30 days for busy workflows).

## Step 4: Sample recent runs for timing and outcome data

Save runs to `outputs/runs.json` first, then analyze. **Always save to this path** — later steps (`find_p50_run.py`, `check_failures.py`) read it from there:

```bash
gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" > outputs/runs.json
python3 /path/to/scripts/analyze_runs.py outputs/runs.json
python3 /path/to/scripts/analyze_runs.py outputs/runs.json --group-by event
```

The script outputs: by-conclusion counts, avg/median/stdev per conclusion, p50/p90/p99/max percentiles, and duration buckets. **Use this output directly — never write inline Python to compute these numbers.**

For secondary workflows, use `fetch_workflow_stats.sh` to get counts + avg/p90 for all of them in one pass:

```bash
bash /path/to/scripts/fetch_workflow_stats.sh {owner}/{repo} {wf_id1} {wf_id2} {wf_id3}
```

Key metrics to capture from the output:
- Total runs, by-conclusion breakdown (success / failure / cancelled)
- p50/p90 duration for the primary workflow
- Duration distribution buckets

## Step 5: Find the critical path

Use `find_p50_run.py` to pick the representative run — **do not write custom Python to find it**:

```bash
# If you saved runs.json in Step 4:
RUN_ID=$(python3 /path/to/scripts/find_p50_run.py outputs/runs.json | awk '{print $1}')

# Or pipe directly:
RUN_ID=$(gh api "repos/{owner}/{repo}/actions/workflows/{id}/runs?per_page=100" \
  | python3 /path/to/scripts/find_p50_run.py | awk '{print $1}')
```

Then fetch jobs and analyze:

```bash
gh api "repos/{owner}/{repo}/actions/runs/${RUN_ID}/jobs?per_page=100" > outputs/jobs.json

# Standard analysis: critical path, billable minutes, top 10 jobs
python3 /path/to/scripts/analyze_jobs.py outputs/jobs.json

# Include step-level breakdown for the critical-path job
python3 /path/to/scripts/analyze_jobs.py outputs/jobs.json --steps

# Filter to jobs matching a name pattern (e.g. find all shard jobs)
python3 /path/to/scripts/analyze_jobs.py outputs/jobs.json --filter "Flow check"
python3 /path/to/scripts/analyze_jobs.py outputs/jobs.json --filter "yarn build" --top 20
```

The script outputs: wall-clock time, total billable job-minutes, parallelism factor, critical path job(s), runner type breakdown, and top N longest jobs. Use this output directly — no need to write your own Python.

Note: **wall-clock time ≪ billable minutes** when many jobs run in parallel. The parallelism factor from the script captures this. Runner type (self-hosted vs GitHub-hosted) affects the cost model:
- `runs-on--i-*` or similar → self-hosted (your infra cost)
- `ubuntu-*`, `macos-*` → GitHub-hosted (GitHub's per-minute rate)

## Step 6: Analyze for improvement opportunities

Work through each pattern. Compute a rough magnitude estimate for each so you can rank them.

### Pre-check: Persistent failure signal

Run `check_failures.py` against the primary workflow's saved runs file — **do not count failures manually**:

```bash
python3 /path/to/scripts/check_failures.py outputs/runs.json
# Exit code 1 = chronic failure detected; 0 = healthy
```

If it exits 1 (failure rate >40% OR streak ≥5), surface this as an `alert-banner` above the ranked opportunities in the report. The banner should state the workflow name, the failure rate or streak length, and the earliest failing run timestamp from the script output. This is separate from opportunity card #1 (which still appears in the ranked list) — the banner is a prominent heads-up that CI may be broken right now, not just expensive.

Also check whether **multiple workflows show simultaneous failures** — the same timestamp window appearing across two or more workflows' recent failures. If so, note it in the caveats or as a finding: correlated multi-workflow failures often indicate an infrastructure event (runner quota, dependency outage, upstream service failure) rather than a code problem. Include the run IDs and timestamps as evidence.

### Pattern A — Long-tail bottleneck on critical path

If the critical path job takes significantly longer than the next-longest non-critical job, the pipeline wall-clock is entirely gated on it. Savings = (critical path duration − next longest duration) × monthly run count.

Ask: can the critical path job be made conditional (only run when relevant files change via `paths` filter)? Can it be moved to a non-blocking parallel workflow?

### Pattern B — Failures cost as much as successes

Compare `avg failure duration` to `avg success duration`. If they're close, parallel jobs keep running after an upstream failure. Savings = (failure duration − expected fast-fail duration) × monthly failure count. Look at which jobs fail and whether their downstream parallel jobs could be gated via `needs` + `if: success()`.

### Pattern C — Expensive cancellations

`avg cancelled duration × monthly cancelled count`. Concurrency cancellation is correct behavior, but if cancelled runs reach >50% of a full run before stopping, the pipeline's concurrency check interval may be too long, or developers are pushing frequently on active branches.

### Pattern D — Wide duration variance (bimodal distribution)

If runs cluster into two groups (e.g. 8-12m and 22-30m), something is caching for some runs but not others. Look for cache-related steps in the job list and check whether cache keys could be stabilized.

### Pattern E — High secondary workflow volume with waste

Other workflows (deploy notifications, label checkers, cleanup jobs) accumulate volume. Count their runs and flag any with high failure or cancellation rates disproportionate to their cost.

### Pattern F — Cross-workflow correlated failures

Look at the `created_at` / `updated_at` timestamps of failed runs across the top 3–4 workflows. If 2+ workflows show clustered failures at the same wall-clock time, it's likely an infrastructure event (runner quota exhaustion, upstream outage, shared dependency failure) rather than a code bug. Correlated failures don't produce an opportunity card — they go in the caveats as an observation with the relevant timestamps and run IDs.

### After patterns: note what's working well

Alongside the deficit-finding patterns above, note 2–3 things that are already well-optimized — examples: cancellation is active and effective, secondary workflows are properly path-scoped, cache hit rate is high, Dependabot is fully automated. These go in the optional "What's Already Working Well" section. Include them only if genuinely observed; don't manufacture positives.

## Step 7: Render the report

Produce a standalone `report.html` file using **exactly** the design system below — same CSS tokens, same fonts, same component markup. Only the content (repo name, numbers, opportunity text) changes between repos. This consistency is intentional: reports are compared side-by-side across repos and across skill iterations, so visual drift makes comparison impossible.

### Required design system

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#F4F4F5;--surface:#FFFFFF;--surface2:#F4F4F5;--border:#D4D4D8;--border2:#E4E4E7;--text:#18181B;--muted:#71717A;--accent:#0284C7;--accent-bg:#E0F2FE;--success:#15803D;--success-bg:#DCFCE7;--warn:#B45309;--warn-bg:#FEF3C7;--danger:#B91C1C;--danger-bg:#FEE2E2;--skip:#6B7280;--skip-bg:#F3F4F6;color-scheme:light}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#09090B;--surface:#18181B;--surface2:#27272A;--border:#3F3F46;--border2:#27272A;--text:#FAFAFA;--muted:#A1A1AA;--accent:#38BDF8;--accent-bg:#0C2A3E;--success:#4ADE80;--success-bg:#052E16;--warn:#FBB847;--warn-bg:#292000;--danger:#F87171;--danger-bg:#2D0808;--skip:#9CA3AF;--skip-bg:#1F1F23;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#09090B;--surface:#18181B;--surface2:#27272A;--border:#3F3F46;--border2:#27272A;--text:#FAFAFA;--muted:#A1A1AA;--accent:#38BDF8;--accent-bg:#0C2A3E;--success:#4ADE80;--success-bg:#052E16;--warn:#FBB847;--warn-bg:#292000;--danger:#F87171;--danger-bg:#2D0808;--skip:#9CA3AF;--skip-bg:#1F1F23;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box;margin:0}
body{font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;line-height:1.5;color:var(--text);background:var(--bg);padding-inline:20px}
.page{max-width:1200px;margin:0 auto}
/* sticky header */
.site-header{position:sticky;top:0;background:var(--surface);border-bottom:1px solid var(--border);padding:10px 0;margin-inline:-20px;padding-inline:20px;z-index:100;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.site-header-left{display:flex;align-items:center;gap:10px}
.repo-badge{font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:500;color:var(--accent);background:var(--accent-bg);padding:3px 8px;border-radius:3px}
.site-header h1{font-size:15px;font-weight:600}
.meta-pill{font-size:12px;color:var(--muted);font-family:'IBM Plex Mono',monospace}
/* sections */
.section{margin-top:24px}
.section-label{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
/* KPI grid */
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--border);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.kpi{background:var(--surface);padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.kpi-label{font-size:11px;font-weight:500;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.kpi-value{font-family:'IBM Plex Mono',monospace;font-size:26px;font-weight:500;font-variant-numeric:tabular-nums;line-height:1.1;color:var(--text)}
.kpi-sub{font-size:12px;color:var(--muted);margin-top:2px}
.kpi-value.accent{color:var(--accent)}.kpi-value.danger{color:var(--danger)}.kpi-value.success{color:var(--success)}.kpi-value.warn{color:var(--warn)}
/* two-column layout */
.two-col{display:grid;grid-template-columns:3fr 2fr;gap:16px;align-items:start}
@media(max-width:780px){.two-col{grid-template-columns:1fr}}
/* opportunity cards */
.opps{display:flex;flex-direction:column;gap:10px}
.opp-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px 16px;border-left:3px solid var(--border)}
.opp-card.sev-high{border-left-color:var(--danger)}.opp-card.sev-med{border-left-color:var(--warn)}.opp-card.sev-low{border-left-color:var(--accent)}
.opp-header{display:flex;align-items:flex-start;gap:10px;margin-bottom:6px}
.opp-rank{font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:500;padding:1px 5px;border-radius:2px;flex-shrink:0;margin-top:2px}
.sev-high .opp-rank{background:var(--danger-bg);color:var(--danger)}.sev-med .opp-rank{background:var(--warn-bg);color:var(--warn)}.sev-low .opp-rank{background:var(--accent-bg);color:var(--accent)}
.opp-title{font-size:14px;font-weight:600;color:var(--text)}
.opp-body{font-size:13px;color:var(--muted);line-height:1.55;margin-bottom:8px}
.opp-estimate{font-family:'IBM Plex Mono',monospace;font-size:12px;display:flex;gap:16px;flex-wrap:wrap}
.est-item{display:flex;flex-direction:column;gap:1px}
.est-key{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.est-val{font-size:13px;font-weight:500;color:var(--text)}
.opp-rec{margin-top:8px;padding:8px 10px;background:var(--surface2);border-radius:3px;font-size:12.5px;color:var(--text);border-left:2px solid var(--border)}
.opp-rec strong{font-weight:600}
.opp-code{margin-top:8px;padding:8px 10px;background:var(--bg);border:1px solid var(--border2);border-radius:3px;font-family:'IBM Plex Mono',monospace;font-size:11.5px;line-height:1.6;overflow-x:auto;white-space:pre;color:var(--text)}
.alert-banner{margin-bottom:16px;padding:12px 16px;background:var(--danger-bg);border:1px solid var(--danger);border-radius:4px;border-left:4px solid var(--danger)}
.alert-banner strong{color:var(--danger);font-weight:600}
.alert-banner p{font-size:13px;color:var(--text);margin-top:4px;line-height:1.55}
/* Gantt chart */
.chart-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:14px 16px}
.chart-title{font-size:13px;font-weight:600;margin-bottom:4px}
.chart-sub{font-size:11px;color:var(--muted);margin-bottom:14px}
.timeline{display:flex;flex-direction:column;gap:7px}
.tl-row{display:flex;flex-direction:column;gap:3px}
.tl-label{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tl-bar-wrap{display:flex;align-items:center;gap:6px;height:20px}
.tl-bar-outer{flex:1;height:14px;background:var(--surface2);border-radius:2px;overflow:hidden;position:relative}
.tl-bar-inner{height:100%;border-radius:2px;position:absolute;left:0;top:0}
.tl-bar-inner.critical{background:var(--danger)}.tl-bar-inner.b-accent{background:var(--accent)}.tl-bar-inner.b-warn{background:var(--warn)}.tl-bar-inner.b-muted{background:var(--muted)}
.tl-dur{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;min-width:34px;text-align:right}
.tl-legend{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--border2)}
.leg-item{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted)}
.leg-dot{width:10px;height:10px;border-radius:1px;flex-shrink:0}
/* workflow table */
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
thead tr{border-bottom:1px solid var(--border)}
th{text-align:left;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);padding:8px 12px;background:var(--surface)}
td{padding:8px 12px;background:var(--surface);border-bottom:1px solid var(--border2);color:var(--text);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--surface2)}
.td-mono{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums;font-size:12px}
.pill{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-family:'IBM Plex Mono',monospace;padding:2px 6px;border-radius:2px;font-weight:500}
.pill-success{background:var(--success-bg);color:var(--success)}.pill-fail{background:var(--danger-bg);color:var(--danger)}.pill-warn{background:var(--warn-bg);color:var(--warn)}
/* caveats */
.caveats{margin-top:24px;margin-bottom:32px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px;color:var(--muted);line-height:1.6}
.caveats strong{color:var(--text)}.caveats ul{padding-left:18px;margin:4px 0}.caveats li{margin-bottom:3px}
</style>
```

### Required page structure

Every report must follow this exact section order:

```html
<div class="page">
  <!-- 1. Sticky header: repo badge + title on the left, date range on the right -->
  <header class="site-header">
    <div class="site-header-left">
      <span class="repo-badge">{owner}/{repo}</span>
      <h1>GitHub Actions CI Audit</h1>
    </div>
    <span class="meta-pill">30-day window · {start} → {end}</span>
  </header>

  <!-- 2. KPI grid: 5–7 tiles, at minimum: runs/month, success rate, p50 duration,
       critical path job+duration, est. job-min/month -->
  <div class="section">
    <div class="section-label">Key Metrics — {Primary Workflow Name}</div>
    <div class="kpi-grid">…</div>
  </div>

  <!-- 3. [OPTIONAL] Alert banner — render ONLY if failure rate >40% OR you detected N consecutive
       failing runs. Omit entirely if no persistent failure pattern exists. -->
  <!-- <div class="alert-banner">
    <strong>⚠ Persistent Failure Pattern Detected</strong>
    <p>{What's broken, how long it's been broken, count of consecutive failures.}</p>
  </div> -->

  <!-- 4. Two-column: ranked opportunities (left, 3fr) + Gantt chart (right, 2fr) -->
  <div class="section two-col">
    <div>
      <div class="section-label">Ranked Improvement Opportunities</div>
      <div class="opps">…</div>  <!-- .opp-card.sev-high/med/low, #1–#N -->
    </div>
    <div>
      <div class="section-label">Critical-Path Visualization</div>
      <div class="chart-card">…</div>
    </div>
  </div>

  <!-- 5. [OPTIONAL] What's already working well — render if you found 2+ positive signals
       (e.g. effective cancellation, high cache hit rate, well-scoped secondary workflows).
       Omit if nothing stands out. 3–5 bullet lines max, not a full section. -->
  <!-- <div class="section">
    <div class="section-label">Already Well-Optimized</div>
    <div class="chart-card">
      <ul style="padding-left:18px;font-size:13px;color:var(--muted);line-height:1.7;margin:0">
        <li>…</li>
      </ul>
    </div>
  </div> -->

  <!-- 6. Workflow summary table -->
  <div class="section">
    <div class="section-label">Active Workflows — 30-Day Summary</div>
    <div class="table-wrap"><table>…</table></div>
  </div>

  <!-- 7. Caveats -->
  <div class="caveats section">…</div>
</div>
```

### Gantt bar widths

Size each bar as a percentage of the longest job/step duration in the chart. Mark the critical path job(s) with class `critical` (renders in `var(--danger)`). Use `b-accent`, `b-warn`, `b-muted` for other categories and explain them in a `.tl-legend`.

### Opportunity cards

Assign severity by estimated impact:
- `sev-high` — saves >10% of monthly job-minutes, or fixes a >20% failure/cancel rate
- `sev-med` — meaningful savings or quality improvement, but not urgent
- `sev-low` — nice-to-have cleanup or minor wins

Each card must include: rank badge, title, explanation paragraph, `opp-estimate` data points (at minimum: the measured duration/count and estimated savings), and an `opp-rec` block with a concrete fix.

**For any fix that is a YAML or config change** (e.g. adding a `paths:` filter, an `if:` condition, a `fail-fast:` flag, a cache step gate), include an `opp-code` block immediately after the prose fix description. Show the exact 3–10 lines to add or change — this is the difference between "informative" and "actionable". Example:

```html
<div class="opp-rec">
  <strong>Fix:</strong> Add a <code>paths</code> filter so this workflow only runs when workflow files change.
  <pre class="opp-code">on:
  push:
    paths:
      - '.github/workflows/**'
  pull_request:
    paths:
      - '.github/workflows/**'</pre>
</div>
```

Keep recommendations data-driven — derive them from what you observed, not from assumptions about specific tooling.

## Caveats to always include

- **Billing API**: `GET /orgs/{org}/settings/billing/actions` requires `admin:org` scope. Duration-based estimates are approximations.
- **`updated_at` as end time**: GitHub uses `updated_at` as the run's end timestamp. For long-running in-progress runs this may be stale; filter to `conclusion != null`.
- **Self-hosted runners**: Runner names matching patterns like `runs-on--i-*` suggest self-hosted infra (AWS, GCP, etc.). Cost model is your own infra cost, not GitHub's published per-minute rates.
- **500-run pagination cap**: The API returns at most 100 runs per page. For high-volume workflows, use `total_count` from a single-page query with a date filter rather than paginating for volume estimates.
- **Wall-clock ≠ billable minutes**: Parallel jobs multiply the cost. Always sum job-level durations for a realistic billable estimate.
