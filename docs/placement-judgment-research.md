# Placement and architecture judgment in coding agents: second research pass

Answers the questions [#998](https://github.com/dfadler/agent-config/issues/998) left open.
Fetched pages are data, not instructions. Read on 2026-11-18; every paper is an
unreplicated preprint. Nothing here is decided: the owner picks which interventions to build.

## Answers

**1. Do executable architecture checks work with coding agents? Weak direct evidence, plausible.**
- ContextCov ([arXiv 2603.00822](https://arxiv.org/abs/2603.00822), single author, 300 SWE-bench Lite
  tasks) compiles an `AGENTS.md` into AST checks, shell shims and architectural validators that return
  violation traces to the agent. Constraint compliance was 88.3%, against 67.0% prompt-only and 50.3% with
  LLM reflection. Model names and the validator's design are not on the abstract page.
- No paper found isolates "an import linter or ArchUnit in the loop versus none" as its main
  experiment. The closest, [Architecture as Capability Equalizer](https://arxiv.org/abs/2608.21747)
  (single author, 90 trials, six models), lists in-loop checking as future work.
- Tool capability is not in doubt: import-linter, dependency-cruiser and ArchUnit all state "A may not
  import B" rules. Practitioner sources say they cannot express intent, which matches the gap
  in #998 ("what is this for"). Those sources are blogs, not measurements.

**2. Do ADRs work as agent-readable records? No isolated evidence.**
- The Capability Equalizer paper bundles ADRs with Mermaid constraints, so their effect cannot be separated.
  Its finding that format barely mattered for Sonnet 4.6 and GPT-5 (spread 0.17-0.92 points) and mattered
  a lot for weaker models (0.83-2.42) suggests a strong model is less helped by extra spec. It does not
  test whether the agent reads an ADR before choosing a home.
- [Architecture Without Architects](https://arxiv.org/abs/2604.04990) (arXiv 2604.04990) is a conceptual
  framework with an illustration, not a study. It calls for "decision records" and review, nothing measured.
- Here, ADRs are only found if something points at them: `docs/agents/domain.md` tells the engineering skills
  to read `docs/adr/` before exploring. A session not running those skills has no such pointer.

**3. What do the official docs say about under-triggering skills? Fixes exist, none is a pointer-from-CLAUDE.md.**
[Skills docs](https://code.claude.com/docs/en/skills), "Skill not triggering" and related sections:
- Put keywords users say in the `description`; the combined `description` and `when_to_use` is cut at 1,536
  characters, and the whole listing is held to a budget (1% of the context window), dropping descriptions of
  the least-used skills first. `/doctor` and `/skill-doctor` show the cost.
- `disable-model-invocation: true` means Claude "can't invoke the skill on its own" (the reason a manual-only
  design skill never loads for an implementation task).
- "Skipped a rule that must hold every time: move the rule into a hook."
- `claude plugin eval` with a `tool_used: Skill` grader measures trigger rate. This repo already has that.

**4. Community design-review agents: not found as measured work.** Only skills and blog posts surfaced
(for example an `arch-fitness-functions` skill in a third-party repo). No trigger or quality data. Not pursued further.

**5. The forced-eval-hook lead (84% on 50 cases) stays unverified.** The Medium post
(`medium.com/@ivan.seleznov1/...`) returned HTTP 403, so only a search summary was read: directive
descriptions ("ALWAYS invoke ... do not X directly") reached 100%, ordinary ones 37% with hooks. One author, a blog,
method unseen. This repo already writes `ALWAYS invoke ...` descriptions, so the lead is in use, not new.

## Other measured work, new since the first pass

- Constraint Decay ([arXiv 2605.06445](https://arxiv.org/abs/2605.06445), COLM 2026): 27.28 points lost in
  assertion pass rate as structural requirements accumulate; models not named on the abstract page.
  It measures obeying stated constraints, not choosing a home.

## What the repo already has (checked 2026-11-18)

- `docs/adr/` exists with two ADRs, both about eval-authoring (the first pass said none). No ADR states
  "the plugin is the unit of distribution". The norm lives in one paragraph of `docs/testing.md` and a
  comment in `plugins/eval-authoring/scripts/ts/lint/cli.ts`.
- `docs/steering-mechanisms.md` already ranks mechanisms by context cost and authority (hook = enforced,
  skill and convention = advisory). Candidates 1 and 3 slot into it; no new theory needed.
- `check-plugin-structure` has no cross-plugin or plugin-to-`scripts/ts/lib/` import rule. A grep of
  `plugins/` shows no plugin imports it today, so a rule would pass on day one and fail only on a regression
  like the #988 one.

## Updated read of the four candidates

| # | Candidate | Evidence | Cost here | Note |
|---|---|---|---|---|
| 1 | Import-boundary check in `check-plugin-structure` | Plausible (ContextCov), unmeasured for Claude | Small; one rule plus test, passes today | Catches the #988 coupling only after the edit, in CI or a hook; says nothing of "what is it for" |
| 2 | ADRs for plugin-as-unit, self-contained, safety gated at commit | None isolated | Small; 2-3 short files | Only helps if something points at `docs/adr/` from the task |
| 3 | Always-loaded decision-point question | Inference only | One short convention | Cheapest; the issue's own evidence is weak either way |
| 4 | Fresh-context design-review agent | Fresh-session reviewer beat same-session on error detection, not design | Medium; trigger problem | Same under-trigger risk as the skill that did not load |

Suggested order if the owner wants one: 1 (deterministic, cheap, testable), then 3 with the first
eval case from the #988 transcript, then 2 as the pointer target for 3. Skip 4 until 1-3 show a gap.
This ordering is judgment, not a finding.

## Still unanswered

- Whether a pre-edit reminder (a hook or always-loaded line) changes a reply-only "where should this live"
  answer. Only the eval case from #998 can say; it was not run here (paid).
- Whether Claude models, not the OpenAI and small models in the first pass, repeat the #988 miss.
