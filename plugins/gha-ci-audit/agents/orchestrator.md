# Orchestrator Agent — gha-ci-audit

Run a complete eval iteration end-to-end: setup → eval agents → grade → aggregate → viewer.

## Invocation

The user (or another agent) provides:
- `N` — the iteration number to run (e.g. `5`)
- `PREVIOUS_N` — the prior iteration number for viewer comparison (optional; omit for the first iteration)

All paths derive from N:
```
PLUGIN=/Volumes/Development/agent-config/plugins/gha-ci-audit
WORKSPACE=/Volumes/Development/agent-config/plugins/gha-ci-audit-workspace
ITER=$WORKSPACE/iteration-N
EVALS=$PLUGIN/evals/evals.json
SCRIPTS=$PLUGIN/scripts
SKILL=$PLUGIN/skills/gha-ci-audit/SKILL.md
```

---

## Step 1: Check if already partially done

Before doing any setup, run:

```bash
python3 $SCRIPTS/check_status.py $ITER 2>/dev/null || echo "not started"
```

If `$ITER` doesn't exist yet, proceed to Step 2.
If it exists and some evals already have `report.html`, skip setup for those evals and proceed to whichever step is next (grading, aggregation, or viewer).
Never overwrite an existing `report.html` or `grading.json`.

---

## Step 2: Set up iteration directory

Read `$EVALS` to get the eval list. The name mapping is:

| id | dir name              |
|----|----------------------|
| 1  | vite-audit           |
| 2  | agent-config-context |
| 3  | facebook-react       |

For each eval, run setup then copy in assertions:

```bash
bash $SCRIPTS/setup_eval.sh "$ITER" vite-audit           1 "$(jq -r '.evals[0].prompt' $EVALS)"
bash $SCRIPTS/setup_eval.sh "$ITER" agent-config-context 2 "$(jq -r '.evals[1].prompt' $EVALS)"
bash $SCRIPTS/setup_eval.sh "$ITER" facebook-react       3 "$(jq -r '.evals[2].prompt' $EVALS)"
```

Then write assertions into each `eval_metadata.json`:

```bash
python3 $SCRIPTS/write_assertions.py $ITER $EVALS
```

---

## Step 3: Spawn all 3 collector agents in one turn

**Spawn all 3 in a single turn so they run concurrently.** Each collector agent receives:

```
Read agents/collector.md at:
  /Volumes/Development/agent-config/plugins/gha-ci-audit/agents/collector.md

Collect data for this eval:
- repo: <owner/repo from eval prompt>
- outputs_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/<eval_name>/with_skill/outputs/
- scripts_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit/scripts/
```

The repo for each eval:
- vite-audit → `vitejs/vite`
- agent-config-context → `dfadler/agent-config`
- facebook-react → `facebook/react`

---

## Step 4: Capture collector timing and spawn renderers

As each collector notification arrives, save timing immediately to a temp file:

```json
{ "collect_tokens": <subagent_tokens>, "collect_ms": <duration_ms> }
```

To: `$ITER/<eval_name>/with_skill/collect_timing.json`

**Once all 3 collectors complete**, verify each `outputs/` directory has `collect_summary.json`, `runs.json`, and `jobs.json`. If any is missing, do not spawn its renderer — flag the eval and ask whether to retry the collector.

Then **spawn all 3 renderer agents in one turn**:

```
Read agents/renderer.md at:
  /Volumes/Development/agent-config/plugins/gha-ci-audit/agents/renderer.md

Render the report for this eval:
- outputs_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/<eval_name>/with_skill/outputs/
- scripts_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit/scripts/
- skill_path: /Volumes/Development/agent-config/plugins/gha-ci-audit/skills/gha-ci-audit/SKILL.md
```

---

## Step 5: Capture renderer timing and write combined timing.json

As each renderer notification arrives, read its `subagent_tokens` and `duration_ms`. Combine with the collector timing to write the final `timing.json`:

```json
{
  "total_tokens": <collect_tokens + render_tokens>,
  "duration_ms": <collect_ms + render_ms>,
  "total_duration_seconds": <(collect_ms + render_ms) / 1000>,
  "phases": {
    "collect": { "tokens": <collect_tokens>, "duration_ms": <collect_ms> },
    "render":  { "tokens": <render_tokens>,  "duration_ms": <render_ms> }
  }
}
```

To: `$ITER/<eval_name>/with_skill/timing.json`

If a renderer notification indicates failure (no `report.html`), flag the eval and ask whether to retry the renderer (do not re-run the collector — the data files are already there).

---

## Step 6: Verify all outputs

After all renderers complete:

```bash
python3 $SCRIPTS/check_status.py $ITER
```

All three should show `✓` for Report and `✓` for Timing. If any eval is missing `report.html`, do not proceed to grading — report the failure with the eval name and ask whether to retry the renderer or skip.

---

## Step 7: Grade all evals in parallel

Spawn all 3 grader agents in a single turn. For each:

```
You are a grader. Read agents/grader.md at:
  /Volumes/Development/agent-config/plugins/gha-ci-audit/agents/grader.md

- assertions: <paste full assertions array from eval_metadata.json>
- outputs_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/<eval_name>/with_skill/outputs/
- eval_metadata_path: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/<eval_name>/with_skill/eval_metadata.json

Grade the outputs and write grading.json to:
  /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/<eval_name>/with_skill/grading.json
```

After all graders complete, run `check_status.py` again and confirm all three show `✓` for Graded.

---

## Step 8: Aggregate

```bash
python3 $SCRIPTS/aggregate.py $ITER --skill-name gha-ci-audit
```

This produces `$ITER/benchmark.json` and `$ITER/benchmark.md`. Print the pass rate line from the output.

---

## Step 9: Launch viewer

```bash
bash $SCRIPTS/launch_viewer.sh $ITER --previous $WORKSPACE/iteration-<PREVIOUS_N>
```

Omit `--previous` if this is the first iteration. The viewer starts at `http://localhost:3117`.

---

## Step 10: Run skill improver (optional but recommended)

Spawn the skill improver agent:

```
Read agents/skill-improver.md at:
  /Volumes/Development/agent-config/plugins/gha-ci-audit/agents/skill-improver.md

- iter_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N
- skill_path: /Volumes/Development/agent-config/plugins/gha-ci-audit/skills/gha-ci-audit/SKILL.md
- previous_iter_dir: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-<PREVIOUS_N>
- output_path: /Volumes/Development/agent-config/plugins/gha-ci-audit-workspace/iteration-N/skill_improvements.md
```

The skill improver runs in parallel with the user's review of the viewer — spawn it after launching the viewer, not before. When it completes, include its proposal count in the summary.

---

## Step 11: Report summary

After the viewer is up, give the user:

1. **Pass rate** (from aggregate output)
2. **Per-eval breakdown**: eval name, pass/fail count, any failed assertions by name
3. **Timing**: total tokens and duration per eval (collect + render phases)
4. **Grader flags**: any data-authenticity concerns or assertion gaps the graders noted
5. **Viewer URL**: `http://localhost:3117`
6. **Skill improvement proposals**: N proposals written to `skill_improvements.md` (once improver completes)

Keep it concise — one paragraph per eval, then a one-line verdict.

---

## Error handling

| Situation | Action |
|-----------|--------|
| Collector produces no `collect_summary.json` | Report to user; ask retry or skip — do not spawn renderer for that eval |
| Renderer produces no `report.html` | Data files are intact — re-spawn renderer only (no re-fetch needed) |
| A grader fails to write `grading.json` | Re-spawn the grader for that eval only |
| `aggregate.py` finds no graded runs | At least one `grading.json` is missing — run `check_status.py` and fix before re-running |
| Viewer port 3117 already in use | The launch script handles this by killing the previous viewer; if it still fails, report the PID conflict |
| Notification arrives with no `duration_ms` | Record `duration_ms: null` in the phase timing file rather than omitting it; note the gap in the summary |
| Skill improver fails | Non-blocking — report the error but do not delay the summary; proposals can be generated separately |
