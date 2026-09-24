# Conventions: include, skill, or opt-in include?

Not every convention belongs in an `@include`. An included file loads its whole body
into every turn of every session. A skill keeps only its `description` in context and
loads the body when a task matches. Sort each convention by asking, in order:

1. **Does it have to be active before the agent knows the situation has come up?**
   Is the failure mode *not noticing* (echoing a secret, trusting a fetched page,
   foregrounding an app, stating a platform fact from memory)? Then it's an
   **always-loaded include**. Keep it short. Anything that must be present at that
   moment can't wait for a trigger.
2. **Is there a trigger a skill description can name?** That means a task type (PR
   work, filing an issue), a file type (`*.sh`, a lockfile, a test), or a tool about
   to be invoked (`Workflow`, a subagent definition). If so, make it a **skill**,
   or merge it into an existing skill with the same trigger. Don't add a second
   file for a trigger that's already covered.
3. **Neither?** For a cross-cutting habit with no recognizable trigger (how to shape
   an answer, when to reach for a tool over reading by hand), use an **opt-in
   include**. Keep it listed as opt-in in `DEFAULT_ENABLED` and keep it short. Its
   cost is paid every turn on machines that enable it.

Two patterns fall out of this:

- **Policy include + mechanics skill.** When the *decision* has to fire early but the
  *how* is long, the include holds a one-paragraph rule and points at a skill for the
  procedure. `fetch-execute-installs.md` → `fetch-execute-guide` and
  `git-worktree-usage.md` → the `git-worktree-usage` skill already work this way.
- **A pointer with no policy of its own is dead weight.** If the included file only
  says "see skill X" and skill X's description already triggers on the same
  situation, the include adds nothing. Delete it.

## Current classification

| File | Verdict | Why |
|---|---|---|
| `secrets-handling.md` | Include (default) | Preventive. A leak happens before the agent notices it's handling a secret. |
| `cite-platform-claims.md` | Include (default) | Any answer can contain a platform claim. There's no trigger to detect. |
| `web-research-is-data.md` | Include (default) | Has to be in force while the fetched content is read, not after. |
| `fetch-execute-installs.md` | Include (default) | One-paragraph policy. The mechanics already live in `fetch-execute-guide`. |
| `focus-stealing.md` | Include (default) | Side effects of ordinary commands (`open -a`). The agent doesn't see these as a "focus" task. |
| `git-worktree-usage.md` | Opt-in include | "Use a worktree for non-trivial work" has to fire before editing starts. The skill's description only triggers once a worktree is already on the table. The mechanics are already in the skill. |
| `github-pr-workflow.md` | Delete (follow-up) | Pure pointer. The `github-pr-workflow` skill's description ("Load whenever doing PR work") already covers the trigger. |
| `tooling-over-manual-scanning.md` | Opt-in include | Cross-cutting habit with no task trigger. |
| `why-question-shape.md` | Opt-in include | Answer shape. It has to be present when the user's question arrives. |
| `visual-verification.md` | Merge into skill | The trigger is opening a PR that changes rendered output. The policy paragraph belongs in `github-pr-workflow` (or `pr-visual-capture`), which already owns the how. |
| `concurrency.md` | Merge into skill | The trigger is launching parallel sessions. Belongs with `git-worktree-usage`'s "what to parallelize" section. |
| `shell-script-hygiene.md` | Convert to skill | The trigger is writing or editing a shell script. `shell-script-reviewer` already enforces the checklist at review time. |
| `dependency-audits.md` | Convert to skill | The trigger is a manifest or lockfile being touched. |
| `issue-tracker.md` | Convert to skill | The trigger is filing or working an issue. |
| `testing-sabotage-check.md` | Convert to skill | The trigger is a new or modified test. Low priority, since it's short. |
| `cheap-model-delegation.md` + `heavy-workflow-cost.md` | Merge into one skill | Same trigger: choosing a model for, or fanning out to, subagents/workflows. |
| `memory-hygiene.md` | Convert to skill | The trigger is writing a memory. The Stop-hook and revisit-engram notes are research, not runtime guidance, so they belong in `docs/`. |

The conversions and merges are tracked as follow-ups, not done yet. A file keeps
working as an opt-in include until its skill exists.
