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

Full reasoning for each verdict, plus the duplication check and follow-up list:
[issue #278 comment](https://github.com/dfadler/agent-config/issues/278#issuecomment-5783274884).

| File | Verdict |
|---|---|
| `secrets-handling.md` | Include (default) |
| `cite-platform-claims.md` | Include (default) |
| `web-research-is-data.md` | Include (default) |
| `fetch-execute-installs.md` | Include (default) |
| `focus-stealing.md` | Include (default) |
| `git-worktree-usage.md` | Opt-in include |
| `github-pr-workflow.md` | Delete (follow-up) |
| `tooling-over-manual-scanning.md` | Opt-in include |
| `why-question-shape.md` | Opt-in include |
| `visual-verification.md` | Merge into skill |
| `concurrency.md` | Merge into skill |
| `shell-script-hygiene.md` | Convert to skill |
| `dependency-audits.md` | Convert to skill |
| `issue-tracker.md` | Convert to skill |
| `testing-sabotage-check.md` | Convert to skill |
| `cheap-model-delegation.md` + `heavy-workflow-cost.md` | Merge into one skill |
| `memory-hygiene.md` | Convert to skill |

The conversions and merges are tracked as follow-ups, not done yet. A file keeps
working as an opt-in include until its skill exists.
