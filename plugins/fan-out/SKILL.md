---
name: fan-out
description: |
  ALWAYS invoke this skill first when the user says "fan out", "split this across
  agents", "solve this with parallel sub-agents", or lets sub-agents spawn their own
  helpers, even when only a plan is asked for: it defines the depth, width and total-agent
  limits to state and obey. Splits the
  prompt into independent subtasks, runs them as parallel sub-agents that may spawn
  their own sub-agents under a fixed depth, width and total-agent budget, and merges
  compact results. Not for small tasks or a single question: use
  `subagent-orchestration` to route those.
license: MIT
metadata:
  version: "1.0.0"
---

# Fan out

## Contract

- **Input:** a prompt to solve, plus optional overrides for the limits below.
- **Output:** one merged answer, a one-line account of how the work was split, and
  which subtasks failed or were skipped.
- **Does not:** decide whether a task deserves heavy parallelism (that is
  `subagent-orchestration`), queue agents, or run past the budget.

## Limits

Defaults. The user can override any of them in the request.

| Limit | Default | Meaning |
|---|---|---|
| `depth` | 2 | Layers of sub-agents below you. The harness hard-stops at 3. |
| `width` | 4 | Children one agent may spawn at once. |
| `budget` | 12 | Total agents in the whole run, all layers. |

The harness also caps concurrent sub-agents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`,
default 20) and nesting (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), per the
[sub-agents docs](https://code.claude.com/docs/en/sub-agents). Stay under those; the
skill's limits are the tighter, per-run layer on top, so no queue is needed.

## Procedure

1. **Decide whether to fan out.** If the prompt is one question, touches one file, or
   has dependent steps, do it directly or with one `Agent` and say so. Fan out only
   when the prompt splits into subtasks that need no one else's output.
2. **Split.** Name the subtasks and what each reads or writes. Subtasks that edit
   files need disjoint file surfaces or their own worktrees; shared generated files
   count as a surface.
3. **Divide the budget before spawning.** You hold `budget`. Reserve 1 for yourself,
   give each child a share of the rest (children run in parallel, so shares must sum
   to at most what you hold). Spawn all children in one message.
4. **Brief each child** with: its subtask, its `depth`/`width`/`budget` remaining
   (`depth` minus 1, its own budget share), and the leaf rule below.
5. **Leaf rule.** An agent with `depth` 0, `budget` 1, or a subtask that is one
   bounded piece of work does it itself and does not spawn.
6. **Merge.** Children return the compact handback from `subagent-orchestration`
   (`summary`, `findings`, `files_changed`, `next_actions`). Each parent folds its
   children's results into one handback of the same shape before returning it up.
7. **Failures.** A child that fails or times out is reported by name in the merge;
   do not retry it more than once, and do not let it sink the run.

## Stop conditions

Stop spawning and finish with what you have when the budget is spent. State the budget
and the split up front in one or two lines so the cost is visible before it is
incurred.
