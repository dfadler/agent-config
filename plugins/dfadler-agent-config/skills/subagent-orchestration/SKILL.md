---
name: subagent-orchestration
description: |
  Use when about to spawn a sub-agent, fan out with the Workflow tool, or run a task
  that would put large tool output (more than ~50 lines, or ~3 file reads) into the
  main context. Routes the work to the main context, a single Agent call, or a
  Workflow; defines the compact handback a delegated agent should return; and picks
  the model tier. Use for "should I delegate this", "which agent do I use", or
  "keep my context small".
license: MIT
metadata:
  version: "1.0.0"
---

# Subagent orchestration

## Contract

- **Input:** a task about to be run, plus a rough guess at how much tool output it
  will produce and, if known, how full the context window is.
- **Output:** a routing decision (main context, `Agent`, or `Workflow`), a model
  tier for any sub-agent, and the handback format to request.
- **Does not:** run the delegated work, enforce the handback format, or decide
  whether a task is worth doing at all.

## Route the work

| Tier | Route here when | Notes |
|---|---|---|
| Main context | Small, bounded task: a single-file edit, a direct answer, a quick lookup. Expected output under ~50 lines. | Only for genuinely self-contained work. |
| `Agent` call (default) | Exploration, research, investigation. Output over ~50 lines or more than ~3 file reads. Context at 40% or more. | Default when in doubt. One `Agent` is always cheaper than a `Workflow`. |
| `Workflow` | The question is both high-stakes and high-uncertainty. Both, not either alone. | Start with one `Agent`; escalate only if it comes back insufficient. |

Open-ended search that will sweep many files goes to an `Agent` (the `Explore` agent
fits); a targeted `grep` for a known symbol can stay in the main context.

## Ask for a compact handback

Put this in the sub-agent's prompt. These are hints, not enforced; task-specific
fields are fine.

| Field | When | Contents |
|---|---|---|
| `summary` | Always | 1-2 sentences: what was done or found |
| `findings` | Research tasks | Bulleted list, at most 5 items |
| `files_changed` | Implementation tasks | Modified file paths |
| `next_actions` | A follow-up exists | At most 3 actionable items |
| `verbatim` | A snippet is explicitly needed | Raw output, clearly delimited |

Tell the agent to digest raw output (grep matches, file contents, CI logs) into
these fields rather than pasting it back. Keep failed steps and error messages; drop
passed steps, progress noise, and repeated lines.

## Pick the model tier

- **Cheaper tier (e.g. Haiku):** Explore-style lookups, mechanical checks, and
  pattern-matchable tasks with objective success criteria and no cross-file reasoning.
- **Parent tier:** judgment, synthesis, cross-file reasoning, open-ended
  investigation. Default when unsure.

The fuller reasoning lives in the opt-in `cheap-model-delegation.md` and
`heavy-workflow-cost.md` conventions, which this skill is meant to absorb in a
follow-up; until then they stay as they are.

The opt-in `context-preservation.md` convention carries the delegation threshold
(40%, with a turn-count fallback) that triggers this skill.
