---
name: fan-out
description: |
  ALWAYS invoke this skill first when the user says "fan out", "split this across
  agents", "solve this with parallel sub-agents", or lets sub-agents spawn their own
  helpers, even when only a plan is asked for. Splits the prompt into independent
  subtasks, runs them in parallel as sub-sessions (sub-agents without session tools) under a fixed depth, width and total-agent budget, and merges compact
  results. Not for small tasks or a single question: use `subagent-orchestration` to
  route those.
argument-hint: "[--budget N] [--depth N] [--width N] <prompt>"
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/ts/limits.ts *)
license: MIT
---

# Fan out

## Contract

- **Input:** `$ARGUMENTS`: the prompt to solve, optionally preceded by `--budget N`,
  `--depth N`, `--width N` to override the defaults in the Limits table.
- **Output:** one merged answer, a one-line account of how the work was split and which
  execution path ran (sub-sessions, sub-agents, or a mix), and which subtasks failed or
  were skipped.
- **Does not:** decide whether a task deserves heavy parallelism (that is
  `subagent-orchestration`), queue agents, or run past the budget.

## Limits

Resolve the limits with the script, not by hand. Pass only the limit flags, never the
prompt: the prompt is free text and must not reach a shell command line (a `$(...)` or
`;` in it would run). Copy only the leading `--budget`, `--depth` and `--width` tokens
from `$ARGUMENTS`, and only when the value is digits:

`node ${CLAUDE_SKILL_DIR}/scripts/ts/limits.ts [--budget N] [--depth N] [--width N]`

It prints one JSON object: `budget`, `depth`, `width` and `shares`, the budget each
first-wave child gets. Use those numbers as given; the prompt is whatever follows the flags
in `$ARGUMENTS`. Exit 2 with `{"error": ...}` means an invalid flag: tell the user the
message and stop. A limit given in plain words ("at most 8 agents") has no flag, so pass it
as one (`--budget 8`). If a flag value is not digits, report it as invalid instead of
passing it on. If Bash is unavailable, apply the table by hand: whole numbers only,
`budget` at least 1, `depth` 0 to 3, an unset `budget` is the env value (else 20), and
bad input is rejected, not clamped.

| Limit | Default | Meaning |
|---|---|---|
| `depth` | 2 | Layers of sub-agents below you, 0 to 3. |
| `width` | 4 | Children one agent may spawn at once. At most `budget` minus 1. |
| `budget` | current max sub-agent count (env value, else 20) | Total agents in the whole run, all layers. |

The harness also caps concurrent sub-agents (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`,
default 20) and nesting (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`), per the
[sub-agents docs](https://code.claude.com/docs/en/sub-agents). Stay under those; the
skill's limits are the tighter, per-run layer on top, so no queue is needed.

The concurrency cap is configurable and shared by the whole tree. If it is set below
your `width`, treat it as your effective width: spawn that many children, and start the
remaining subtasks as running ones finish. A spawn refused for the concurrency limit is
staging, not a failed child.

## Execution path

Each child is one agent against `budget`, whichever path runs it.

- **Sub-session (default).** Use it when the `start_session` tool is available (Claude
  Code Desktop). Start each child with `initiation: "user_asked"` (the user asked for the
  fan-out) and `context: "fresh"`. A sub-session keeps its tool output out of this
  session's context, and the user can open, steer or stop it.
- **Sub-agent (fallback).** Use an `Agent` call when `start_session` is unavailable (CLI
  and other hosts) or the app refuses a start. Run only the refused subtask this way and
  keep the other children as sub-sessions.

Name the path in the up-front statement under Stop conditions. The skill has not checked
whether a sub-session can start sub-sessions or any depth cap on that: tell each child
its remaining `depth`, and have it use `Agent` when its own start is refused.

## Procedure

1. **Decide whether to fan out.** If the prompt is one question, touches one file, or
   has dependent steps, do it directly or with one `Agent` and say so. Fan out only
   when the prompt splits into subtasks that need no one else's output.
2. **Split.** Name the subtasks and what each reads or writes. Subtasks that edit
   files need disjoint file surfaces or their own worktrees (start such sub-sessions
   with `use_worktree: true`); shared generated files count as a surface.
3. **Divide the budget before spawning.** You hold `budget`. Reserve 1 for yourself
   and give each child its entry in `shares`. Shares sum to at most what you hold.
   Below the first layer, split what you were given the same way. Start the first
   wave of children (up to `width`, or the concurrency cap if lower) in one message.
4. **Brief each child** with: its subtask, its `depth`/`width`/`budget` remaining
   (`depth` minus 1, its own budget share), the handback cap (summary under 10
   lines), and step 5, Leaf rule. For a sub-session, also say: put the handback in the
   final message with the summary first, because only the first 400 characters reach
   the parent in the completion note; write anything longer to a file and give its
   absolute path in `findings`.
5. **Leaf rule.** An agent with `depth` 0, `budget` 1, or a subtask that is one
   bounded piece of work does it itself and does not spawn.
6. **Merge.** Children return the compact handback from `subagent-orchestration`
   (`summary`, `findings`, `files_changed`, `next_actions`). Sub-agents return it in the
   same turn. Sub-sessions report asynchronously: after starting them, end your turn
   without polling; the app continues you with a `<side-sessions-event>` once none is
   still working, and you merge from the completion notes and any files they name. Each
   parent folds its children's results into one handback of the same shape before
   returning it up.
7. **Failures.** A child that fails or times out is reported by name in the merge;
   retry it once at most, and only if unspent budget remains (a retry is a new
   agent or sub-session). Use the retry's result if it succeeds; if it fails or times out, or no budget
   remains, continue the run without that child.

## Stop conditions

Stop spawning and finish with what you have when the budget is spent. State the budget,
the execution path and the split up front in one or two lines so the cost is visible before it is
incurred.
