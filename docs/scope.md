# What belongs here vs. in a project

If a rule/skill/agent only makes sense with a specific repo's paths, scripts, or stack
knowledge baked in, it stays in that project's own `.claude/`. This repo is for the
parts that would otherwise get copy-pasted into every new project's config.

This repo is a **portable-subset collector**, not a single upstream source of truth.
In practice, a skill's substantive work often happens in whichever project needs it
first — under that project's own PR review, with that project's context — and a
genericized version lands here afterward, stripped of repo-specific paths and
tooling references. Content flows in both directions depending on where the work
actually happens; there's no fixed "canonical" side.

One consequence: a project may keep its own copy of something that also lives here,
if that project's CI needs it — GitHub Actions runners check out only the repo, not
this machine's `~/.claude`, so anything a CI job invokes (a skill it `cat`s into a
prompt, a rubric it loads) has to physically exist in that repo. Some of these copies
are meant to diverge permanently and by design — a project's copy keeps repo-specific
sections that never belonged here, while this repo keeps only the generic structure —
and that's a legitimate fork, not drift to reconcile. Others are copies that happened
to fall out of sync with no one noticing; those are worth fixing when the cost of the
divergence actually shows up (the same bug fixed twice, independently), not on a fixed
sync schedule or via automated tooling. When in doubt about which kind a given copy
is, check whether the divergence is a deliberate structural choice (different
architecture, not just newer content) before assuming it needs reconciling.
