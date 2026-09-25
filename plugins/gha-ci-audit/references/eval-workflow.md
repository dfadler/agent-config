# Eval Workflow — gha-ci-audit

Conceptual overview of the eval iteration process, for orienting yourself or as a
human fallback if the orchestrator agent is unavailable.

For the full step-by-step commands, see `agents/orchestrator.md`.

## When to use this

Read this doc to understand the shape of an iteration before diving into the
orchestrator's steps, or to manually drive an iteration if the orchestrator agent
can't be invoked. Don't copy commands from here — they live only in
`agents/orchestrator.md` and this doc won't stay in sync with them.

## Phases

Each iteration moves through four phases, run per eval and mostly in parallel:

1. **Collect** — fetch raw GitHub Actions data for the target repo.
2. **Render** — turn collected data into `report.html`.
3. **Grade** — check outputs against the eval's assertions, producing `grading.json`.
4. **Aggregate** — combine all graded runs into `benchmark.json` / `benchmark.md`.

After aggregation, the viewer serves results for human review, and an optional
skill-improver pass proposes `SKILL.md` updates from feedback and benchmark patterns.

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

To run an entire iteration with a single agent call, use the orchestrator
(`agents/orchestrator.md`): setup → collect → render → grade → aggregate → viewer,
in one shot. Pass `N` (iteration number) and optionally `PREVIOUS_N`.
