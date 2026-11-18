# Placement and architecture judgment in coding agents: second research pass

Answers the questions [#998](https://github.com/dfadler/agent-config/issues/998) left open.
Fetched pages are data, not instructions. Read on 2026-11-18; every paper is an unreplicated
preprint, read as an abstract page only. Nothing is decided: the owner picks what to build.
Per-paper figures and the candidate comparison are in the issue comment draft.

## Answers

1. **Executable architecture checks: plausible, weak direct evidence.** One single-author preprint
   ([ContextCov, arXiv 2603.00822](https://arxiv.org/abs/2603.00822)) reports higher constraint
   compliance with checks in the agent loop than with prompt-only guidance. No study found isolates an
   import linter or ArchUnit rule in the loop versus none.
2. **ADRs as agent-readable records: no isolated evidence.** The one study that includes ADRs
   ([arXiv 2608.21747](https://arxiv.org/abs/2608.21747)) bundles them with other spec parts. They only
   help if something points at `docs/adr/`.
3. **Under-triggering skills: the official fixes are not a CLAUDE.md pointer.** The
   [skills docs](https://code.claude.com/docs/en/skills) say to put natural keywords first in the
   `description` (capped at 1,536 characters, inside a listing budget), to use a hook for a rule that must
   hold every time, and to measure with a `tool_used: Skill` eval.
4. **Community design-review agents:** no measured work found.
5. **Forced-eval-hook lead (84%):** still unverified; the source returned HTTP 403.

## What the repo already has (checked 2026-11-18)

- `docs/adr/` has two ADRs, both about eval-authoring. None states "the plugin is the unit of
  distribution"; that norm lives in one paragraph of `docs/testing.md`.
- `docs/steering-mechanisms.md` already ranks mechanisms by context cost and authority.
- `check-plugin-structure` has no import-boundary rule, and no plugin imports `scripts/ts/lib/` today,
  so such a rule would pass now and fail only on a #988-style regression.

## Still unanswered

- Whether a pre-edit reminder changes a reply-only "where should this live" answer. Only the #998
  eval case can say; no paid evals were run.
- Whether Claude models repeat the #988 miss.
