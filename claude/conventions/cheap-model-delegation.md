## Cheap-model delegation for low-complexity subagent tasks

The `Agent` tool (Claude Code / Claude Agent SDK) accepts a `model` override
per subagent call or per agent definition. Mechanical, low-complexity
subagent work doesn't need the parent session's default model tier — a
cheaper model (e.g. Haiku 4.5) does the same job for a fraction of the token
cost, without a quality tradeoff on tasks that don't call for judgment in the
first place.

- **Qualifies for a cheap-model override:** Explore-style file/symbol lookups
  ("find where X is defined", "which files reference Y"), mechanical
  formatting or lint-style checks against a fixed checklist, and other work
  whose success criteria are objective and pattern-matchable — not work that
  requires weighing tradeoffs or synthesizing across unrelated context.
- **Keep the full-capability (parent-tier) model** for anything requiring
  judgment, synthesis, cross-file reasoning, or open-ended investigation
  where the right answer depends on interpreting intent rather than matching
  a pattern — security/architecture review, debugging, design decisions.
  Don't downgrade these: a cheaper model missing a real finding costs more
  than the tokens it would have saved.
- When it's unclear which bucket a task falls into, default to the parent's
  model rather than guessing down a tier.
- This repo already has a working example of tiered selection across its own
  agent definitions (`plugins/dfadler-agent-config/agents/`):
  `shell-script-reviewer.md` runs a fixed shellcheck/shfmt checklist and is
  pinned to `model: haiku`; `docs-staleness-checker.md` has to judge whether
  prose is still true against code and runs `model: sonnet`;
  `adversarial-reviewer.md` does deep cross-file security/concurrency
  reasoning and is pinned to `model: opus`. That spread is a reasonable
  reference point for calibrating a new subagent's tier.
- This is CLI-agent-authoring guidance — advice for an agent choosing a
  `model:` value when defining or invoking a subagent — not a claim about
  Claude Code product usage limits or pricing. See `docs/usage-optimization.md`
  for the broader cost-optimization audit this complements (its §1 covers the
  existing model-tier finding, §3 covers subagent/workflow fan-out); that
  audit is a point-in-time review, not a living practice doc, so this file is
  the place new cheap-model calls should actually be made, not a duplicate of it.

