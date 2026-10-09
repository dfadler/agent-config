---
name: subagent-orchestration
description: |
  Use when about to spawn a sub-agent, fan out with the Workflow tool, or run a task
  that would put large tool output (more than ~50 lines, or ~3 file reads) into the
  main context. Routes the work to the main context, a single Agent call, or a
  Workflow; defines the compact handback a delegated agent should return; and picks
  the model tier. Use for "should I delegate this", "which agent do I use", or
  "keep my context small". Also use when handed a list of several independent tasks,
  to decide which can run in parallel.
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

## Fan out an unordered task list

Applies to a list of two or more distinct items ("fix X, add Y, update docs for Z"),
not to one task with substeps.

1. **Triage.** For each item note its file surface and whether it needs another
   item's output.
2. **Group.** Disjoint file surfaces and no ordering dependency make items parallel
   candidates. Items that share files or depend on each other stay serial or go to one
   agent. File-surface rules: the `git-worktree-usage` skill.
3. **State the plan** in a line or two (what runs in parallel, what stays serial, why)
   before dispatching.
4. **Dispatch** the independent `Agent` calls in a single message, each in its own
   worktree if it edits files, with the handback below and a model tier from below.
5. **Cap the count.** Fan out only a few agents; batch small items into one agent
   rather than one agent each. Trivial items stay in the main context.

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

Cheap-model overrides go through the `Agent` tool's `model` parameter (or an agent
definition's `model:` field). What qualifies: Explore-style lookups ("find where X is
defined"), mechanical formatting or lint-style checks against a fixed checklist, and
other work with objective, pattern-matchable success criteria. Keep the parent tier for
security/architecture review, debugging, and design decisions: a cheaper model missing a
real finding costs more than the tokens saved. When unclear, default to the parent's
model. This repo's own reviewer agents show the spread: `shell-script-reviewer` (fixed
checklist, `haiku`), `docs-staleness-checker` (judges prose against code, `sonnet`),
`adversarial-reviewer` (deep cross-file reasoning, `opus`).

## When a heavy fan-out is worth its cost

A multi-agent fan-out (`Workflow`, `/code-review ultra`, a cloud multi-agent review) is
an order of magnitude or more expensive than a direct answer or one `Agent` call; one
`deep-research` run has burned 8.1M subagent tokens across 105 agent calls. Reserve it
for questions that are both high-stakes (expensive to get wrong, or gating other work)
and high-uncertainty (not knowable from existing knowledge, a targeted search, or one
agent's read of the files). Breadth across many independent sources, or a review that
needs several angles reconciled, are the concrete shapes.

Default lighter when the answer is findable (a file, a doc, a grep), the task is bounded
to known files or one sub-problem, or "run deep-research" is a reflex. Scale the cost
tier to what is riding on the answer; when unsure, start cheap and escalate only if it
comes back insufficient. This is a judgment call, not a hard gate (cost audit:
`docs/usage-optimization.md`).

The opt-in `context-preservation.md` convention carries the delegation threshold
(40%, with a turn-count fallback) that triggers this skill.
