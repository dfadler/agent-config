---
name: diagnose-scores
description: Explain why an eval case scored low - negative or zero Δ, 0.00 on output that looks correct, exit 1 or 2 with fine-looking results. Free, read-only.
argument-hint: "[results-dir | aggregate-result.json | plugin-path]"
---

# Diagnose eval scores

## Contract

- **Input:** `$ARGUMENTS`: an `aggregate-result.json`, the results directory holding one,
  or a plugin path. With no argument, use the plugin in the working directory.
- **Output:** the score-diagnoser agent's report, relayed as is: per case that is not
  useful, a cause, the evidence and the next step.
- **Does not:** start a paid run, edit cases or the plugin, compute a Δ or a verdict
  itself, or restate the script's thresholds or the agent's interpretation rules.

A thin dispatcher. The diagnosis script
(`${CLAUDE_SKILL_DIR}/../../scripts/ts/diagnose/diagnose.ts`, run with `--help`) finds the
facts and gives each case a verdict, and the
[score-diagnoser agent](../../agents/score-diagnoser.md) interprets them. The script is
free (no model calls). This skill only finds the result file and hands it over.

## Steps

1. **Find the result file.** A file argument is used as given. A directory is searched for
   `aggregate-result.json`. A plugin path means `<plugin>/evals/results/<timestamp>/`:
   take the newest timestamp that has one. Say which file you chose. If none exists, stop
   and say so: a run is needed first, and starting it is the user's call (see the
   [run-evals](../run-evals/SKILL.md) skill).
2. **Dispatch the agent.** Delegate to the `@agent-eval-authoring:score-diagnoser`
   subagent (the @-mention form of a plugin agent's scoped `plugin-name:agent-name`, per
   the [subagent docs](https://code.claude.com/docs/en/sub-agents)). Its prompt carries only
   the absolute result path and the absolute path of the diagnosis script above; the agent
   runs the script itself, so do not run it here as well or paste the report into the
   prompt. Use the agent so the verbose result file stays out of this context.
3. **Relay the report.** Pass it on without softening or adding to it. If the agent is
   unavailable, run the script with `--format text` on the file and relay that output as
   the verdict, without interpreting it.

## Gotchas

- `claude plugin eval` fails a run below its pass threshold, and the default is strict
  (`1.0`), so exit 1 with scores that look fine is common. A low score and a failed gate
  are different questions; the report says which one it is.
- Partial or rate-limited runs (exit 7 from the [run-evals](../run-evals/SKILL.md)
  wrapper) are not regressions. Pass the file through anyway; the agent knows.
- A result file is verbose. Do not read it whole here.
