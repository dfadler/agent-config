---
description: Tear the current changes apart — launches the hostile adversarial-reviewer subagent
---

Launch the `adversarial-reviewer` subagent via the Agent tool to review the
target below. It runs in isolated context, hunts for correctness/security/
concurrency/edge-case/architecture defects with zero sycophancy, and reports
findings with `file:line`, a concrete failure scenario, and a demanded fix.

Target: $ARGUMENTS

If no target is given above, tell the agent to review the current branch's diff
against `main`. Relay the agent's findings back verbatim — do not soften them,
and do not add a summary that reads as approval.
