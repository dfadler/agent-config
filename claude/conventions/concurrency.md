## Concurrency: how many parallel sessions to run

Multiple Claude Code sessions in parallel need their own budget, not just
their own worktree (see the `git-worktree-usage` skill's file-surface
isolation guidance) — pick a number, don't default to "as many as fit."

- **Default to roughly 2-5 concurrent agents.** Review bandwidth is the
  constraint that binds first for most reported use — past that range, diffs
  arrive faster than they can be reviewed well. Only go higher with a
  concrete plan for who reviews the extra output.
- **Usage/rate-limit quota scales roughly with concurrent sessions**
  ([docs](https://code.claude.com/docs/en/agents)). Burst/concurrency
  rate-limiting — distinct from monthly quota exhaustion — has hit users on
  even the highest-paid tier when 5-10 sessions were launched in quick
  succession (`anthropics/claude-code#53922`, `#62426`). Stagger session
  starts instead of bulk-launching many at once.
- **Cost scales with concurrency too.** A rough, dated ballpark: ~$50-130/day
  for 5-10 parallel agents at current (2026) pricing — an order-of-magnitude
  planning estimate, not a live quote; check current pricing before
  budgeting against it.

