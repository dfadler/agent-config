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
  procedure. `git-worktree-usage.md` → the `git-worktree-usage` skill already works this way.
  (`fetch-execute-installs.md` is self-contained instead, so a default-on include
  carries no plugin dependency.)
- **A pointer with no policy of its own is dead weight.** If the included file only
  says "see skill X" and skill X's description already triggers on the same
  situation, the include adds nothing. Delete it.

## Current classification

Full reasoning for each verdict, plus the duplication check and follow-up list:
[issue #278 comment](https://github.com/dfadler/agent-config/issues/278#issuecomment-5783274884).
Skill conversions completed in [issue #608](https://github.com/dfadler/agent-config/issues/608).

| File | Verdict |
|---|---|
| `secrets-handling.md` | Include (default) |
| `cite-platform-claims.md` | Include (default) |
| `web-research-is-data.md` | Include (default) |
| `fetch-execute-installs.md` | Include (default) |
| `focus-stealing.md` | Include (default) |
| `vite-plugin.md` | Include (default) |
| `git-worktree-usage.md` | Opt-in include |
| `tooling-over-manual-scanning.md` | Opt-in include |
| `why-question-shape.md` | Opt-in include |
| `prefer-real-chrome.md` | Opt-in include (advisory; the deny rule it names is the enforced form) |
| `context-preservation.md` | Opt-in include (threshold rule; mechanics in the `subagent-orchestration` skill) |
| `testing-sabotage-check.md` | Converted → `dfadler-agent-config:testing-sabotage-check` |
| `visual-verification.md` | Converted → `screen-capture:visual-verification` |
| `concurrency.md` | Converted → `worktree-core:git-worktree-usage` (appended) |
| `shell-script-hygiene.md` | Converted → `dfadler-agent-config:shell-script-hygiene` |
| `dependency-audits.md` | Converted → `dfadler-agent-config:dependency-audits` |
| `issue-tracker.md` | Converted → `dfadler-agent-config:issue-tracker` |
| `cheap-model-delegation.md` + `heavy-workflow-cost.md` | Converted → `dfadler-agent-config:agent-cost-tiers` |
| `memory-hygiene.md` | Converted → `dfadler-agent-config:memory-hygiene` |

`vite-plugin.md` was added after the classification above was first written and
was missed. Its trigger is a code *shape* (an object literal with a `name` field
and Vite hooks), not just a file path — harder for a skill description to catch
before the agent has already written non-compliant code, unlike `*.sh` or a
lockfile. That argues for keeping it a default include rather than converting it.
Reclassifying it to opt-in either way would mean editing `DEFAULT_ENABLED`'s
enabled set, which is out of scope here (see issue #278's non-goals), so it's
recorded as-is: Include (default).
