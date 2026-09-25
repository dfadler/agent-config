## Isolation: use git worktrees for non-trivial work

When a repo can have more than one Claude Code session running against it at once —
or even solo, to keep the main checkout clean and easy to reason about — use a **git
worktree** for anything beyond a one-line edit: new features, multi-file changes,
background or parallel tasks. Never commit directly to the main working copy.

For the mechanics — creating worktrees with `EnterWorktree` (never raw `git
worktree add`), locking and the stale-worktree sweep, picking what to
parallelize by file surface, the repo-wide `git stash` collision hazard,
branch naming, CI/coverage gotchas after a merge, catching a branch that
already has an open PR up to a moved `main` via merge (not rebase), how to
escalate a merge conflict, and how to split an already-written PR — see the
`dfadler-agent-config:git-worktree-usage` skill.

