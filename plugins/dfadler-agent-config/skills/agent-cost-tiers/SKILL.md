---
name: agent-cost-tiers
description: |
  Two-part guidance for keeping multi-agent costs proportionate: (1) cheap-model
  delegation — when to pass `model: haiku` vs. the full-tier model on a subagent
  call; (2) heavy-workflow gates — when a multi-agent fan-out (Workflow tool,
  `/code-review ultra`, cloud multi-agent) is worth its order-of-magnitude cost.
  Load when defining a new subagent, choosing a `model:` override, or deciding
  whether to reach for the Workflow tool vs. a single Agent call.
license: MIT
metadata:
  version: "1.0.0"
---

# Agent cost tiers

## Cheap-model delegation

The `Agent` tool accepts a `model` override per subagent call or per agent
definition. Mechanical, low-complexity work doesn't need the parent session's
model tier.

**Qualifies for a cheap-model override (e.g. `model: haiku`):**
- Explore-style file/symbol lookups ("find where X is defined")
- Mechanical formatting or lint-style checks against a fixed checklist
- Work whose success criteria are objective and pattern-matchable

**Keep the full-capability model for:**
- Anything requiring judgment, synthesis, or cross-file reasoning
- Security/architecture review, debugging, design decisions
- Open-ended investigation where the right answer depends on intent

When unsure, default to the parent's model rather than guessing down.

**Reference tiers from this repo's own agents** (`plugins/dfadler-agent-config/agents/`):
- `shell-script-reviewer.md` — fixed shellcheck/shfmt checklist → `model: haiku`
- `docs-staleness-checker.md` — judges whether prose is still true → `model: sonnet`
- `adversarial-reviewer.md` — deep cross-file security/concurrency reasoning → `model: opus`

## Heavy-workflow gates

A multi-agent fan-out (the `Workflow` tool, `/code-review ultra`, a cloud
multi-agent review) is an order of magnitude or more expensive than a direct
answer or a single `Agent` call. One `deep-research` run has burned 8.1M
subagent tokens across 105 agent calls in a single invocation.

**Reach for heavy fan-out only when both:**
- **High-stakes** — the decision is expensive to get wrong, or gates other work
- **High-uncertainty** — the answer isn't already knowable from a targeted
  search or one agent's read of the relevant files

**Default to lighter weight when:**
- The question has a findable answer (a file, a doc, a grep)
- The task is bounded to a known set of files or one clear sub-problem
- "Run deep-research" is the reflex rather than a considered choice

When unsure which tier fits, start with the cheaper one and escalate only if
it comes back insufficient — rather than starting heavy "to be safe."
