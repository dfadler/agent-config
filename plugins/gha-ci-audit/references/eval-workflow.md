# Eval Workflow — gha-ci-audit

The canonical sequence for running, grading, and reviewing an eval iteration. Follow this exactly so every session produces a comparable, reproducible result.

## Directory conventions

```
plugins/gha-ci-audit-workspace/
└── iteration-N/
    ├── <eval_name>/
    │   └── with_skill/
    │       ├── eval_metadata.json   (written by setup_eval.sh)
    │       ├── outputs/report.html  (written by eval agent)
    │       ├── timing.json          (written by orchestrator from task notification)
    │       └── grading.json         (written by grader agent)
    ├── benchmark.json               (written by aggregate.py)
    ├── benchmark.md                 (written by aggregate.py)
    └── feedback.json                (written by viewer when user submits)
```

`N` increments with each iteration. Never modify a previous iteration's outputs.

The skill lives at:
```
plugins/gha-ci-audit/skills/gha-ci-audit/SKILL.md
```

Scripts live at:
```
plugins/gha-ci-audit/scripts/
```

Agent instruction files live at:
```
plugins/gha-ci-audit/agents/
```

To run an entire iteration with a single agent call, use the orchestrator:
- `agents/orchestrator.md` — runs setup → eval agents → timing capture → grading → aggregate → viewer in one shot. Pass `N` (iteration number) and optionally `PREVIOUS_N`. The orchestrator handles the timing-capture problem by receiving completion notifications from its own eval sub-agents directly.

---

## Step 1: Set up the iteration directory

For each eval in `evals/evals.json`, call `setup_eval.sh` to create the directory structure and seed `eval_metadata.json`. Do this for all evals before spawning any agents.

```bash
WORKSPACE=/Volumes/Development/agent-config/plugins/gha-ci-audit-workspace
PLUGIN=/Volumes/Development/agent-config/plugins/gha-ci-audit
ITER=$WORKSPACE/iteration-N

bash $PLUGIN/scripts/setup_eval.sh "$ITER" vite-audit           1 "Audit GitHub Actions for vitejs/vite..."
bash $PLUGIN/scripts/setup_eval.sh "$ITER" agent-config-context 2 "Our CI pipelines feel slow..."
bash $PLUGIN/scripts/setup_eval.sh "$ITER" facebook-react       3 "What does the GitHub Actions usage look like for facebook/react?..."
```

After setup, update `eval_metadata.json` for each run to include the assertions from `evals/evals.json` (copy them in). `setup_eval.sh` creates the files with empty assertions; fill them before spawning agents.

---

## Step 2: Spawn all agents in one turn

**Spawn all 3 eval agents in a single turn** so they run concurrently and you get comparable timing.

**Agent prompt template:**
```
Execute this task using the skill at:
  <plugin_path>/skills/gha-ci-audit/SKILL.md

Task: <eval prompt from evals.json>

Save all outputs to:
  <iteration_dir>/<eval_name>/with_skill/outputs/

The primary output must be report.html in that directory.
```

---

## Step 3: Capture timing data from task notifications

When each agent completes, you receive a task notification containing `total_tokens` and `duration_ms`. **Save this immediately** — it's only available at notification time.

Write `timing.json` to the run directory:

```json
{
  "total_tokens": 84852,
  "duration_ms": 143000,
  "total_duration_seconds": 143.0
}
```

Do this as each notification arrives; don't try to batch them.

---

## Step 4: Check status

```bash
python3 $PLUGIN/scripts/check_status.py $ITER
```

This shows which runs have outputs and which still need grading. All runs should have `report.html` before proceeding to grading.

---

## Step 5: Grade all runs

For each run that has outputs but no `grading.json`, spawn a grader agent. Grade all 3 in parallel in a single turn.

Read `agents/grader.md` for the full grader instructions. The prompt to send:

```
You are a grader. Read agents/grader.md for your instructions.

- assertions: <paste assertions array from eval_metadata.json>
- outputs_dir: <iteration_dir>/<eval_name>/with_skill/outputs/
- eval_metadata_path: <iteration_dir>/<eval_name>/with_skill/eval_metadata.json

Grade the outputs and write grading.json to <iteration_dir>/<eval_name>/with_skill/grading.json
```

After all graders complete, run check_status again to confirm all `grading.json` files exist.

---

## Step 6: Aggregate benchmark

```bash
python3 $PLUGIN/scripts/aggregate.py $ITER --skill-name gha-ci-audit
```

This reads all `grading.json` files and produces `benchmark.json` and `benchmark.md`.

---

## Step 7: Analyzer pass (optional but recommended)

Spawn one analyzer agent. Read `agents/analyzer.md` for instructions. The prompt:

```
You are an analyzer. Read agents/analyzer.md for your instructions.

- benchmark_path: <iteration_dir>/benchmark.json
- skill_path: <plugin>/skills/gha-ci-audit/SKILL.md
- output_path: <iteration_dir>/analyzer_notes.json
```

After it completes, update `benchmark.json` to include the notes:

```python
import json
benchmark = json.load(open("benchmark.json"))
notes = json.load(open("analyzer_notes.json"))
benchmark["notes"] = notes
json.dump(benchmark, open("benchmark.json", "w"), indent=2)
```

---

## Step 8: Launch the viewer

```bash
bash $PLUGIN/scripts/launch_viewer.sh $ITER --previous $WORKSPACE/iteration-$(( N - 1 ))
```

The viewer serves at `http://localhost:3117` by default. Tell the user to review results there. The "Outputs" tab shows each eval side by side; the "Benchmark" tab shows pass rates, timing, and tokens.

---

## Step 9: Read feedback

When the user clicks "Submit All Reviews" in the viewer, `feedback.json` is written to `$ITER/feedback.json`. Read it:

```bash
cat $ITER/feedback.json
```

Empty feedback means the user thought it was fine. Focus improvements on evals where the user left comments.

---

## Step 10: Improve the skill

Based on feedback and benchmark patterns, update `skills/gha-ci-audit/SKILL.md`. Key improvement areas for this skill:

- **Design consistency**: If with_skill reports still vary in layout, make the CSS template in Step 7 more prescriptive
- **Data depth**: If agents skip per-job timing data, tighten the API call sequence in Steps 4–5
- **Opportunity quality**: If opportunity cards lack quantification, add explicit examples to the card format section
- **Fabrication prevention**: If agents invented data instead of calling the API, add a verification step

After updating the skill, increment to `iteration-(N+1)` and repeat from Step 1.

---

## Quick reference — common commands

```bash
PLUGIN=/Volumes/Development/agent-config/plugins/gha-ci-audit
WORKSPACE=/Volumes/Development/agent-config/plugins/gha-ci-audit-workspace
ITER=$WORKSPACE/iteration-2

# Check what's done
python3 $PLUGIN/scripts/check_status.py $ITER

# Aggregate after grading
python3 $PLUGIN/scripts/aggregate.py $ITER

# Launch viewer (with iteration-1 as previous)
bash $PLUGIN/scripts/launch_viewer.sh $ITER --previous $WORKSPACE/iteration-1

# Kill viewer
kill $(cat $ITER/.viewer.pid)
```
