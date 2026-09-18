## When a heavy multi-agent workflow is worth its cost

A multi-agent fan-out (the `Workflow` tool, `/code-review ultra`, a cloud
multi-agent review) is an order of magnitude or more expensive than a direct
answer or a single `Agent` call — one `deep-research` run has burned 8.1M
subagent tokens across 105 agent calls in a single invocation. Reserve that
tier for questions where the stakes or the uncertainty justify it; default to
a direct answer or a single `Agent` call otherwise.

- **Reach for heavy fan-out when:** the question is high-stakes (a decision
  that's expensive to get wrong, or that gates other work) *and* high-uncertainty
  (the answer isn't already knowable from existing knowledge, a targeted
  search, or one agent's read of the relevant files) — both conditions, not
  either alone. Breadth across many independent sources, or a review that
  genuinely needs several angles run in parallel and reconciled, are the
  concrete shapes this covers.
- **Default to lighter weight when:** the question has a findable answer (a
  file, a doc, a grep), the task is bounded to a known set of files or one
  clear sub-problem, or "run deep-research" is the reflex rather than a
  considered choice. A single `Agent` call or a direct search covers the vast
  majority of these at a fraction of the cost.
- Cost tier should scale with what's actually riding on the answer — a
  one-off question about a small repo doesn't warrant the same spend as a
  cross-cutting architectural decision. When unsure which tier fits, start
  with the cheaper one and escalate only if it comes back insufficient,
  rather than starting heavy "to be safe."
- This is a workflow-preference judgment call, not a hard gate — see
  `docs/usage-optimization.md` for a prior cost audit of this repo's own
  fan-out surface (it found no problematic in-repo fan-out at the time; this
  file is the general heuristic that audit's findings didn't yet cover).
