---
name: skill-improver
description: >-
  Proposes targeted edits to SKILL.md based on grading evidence without applying them.
---
# Skill Improver Agent — gha-ci-audit

Propose specific, targeted edits to `SKILL.md` based on grading evidence. Does not apply changes — produces a human-reviewable proposal.

## Inputs

- **iter_dir**: path to the latest iteration (e.g. `.../iteration-4`)
- **skill_path**: path to `skills/gha-ci-audit/SKILL.md`
- **previous_iter_dir**: path to prior iteration (optional — enables trend analysis)
- **output_path**: where to write `skill_improvements.md` (default: `{iter_dir}/skill_improvements.md`)

---

## Step 1: Read benchmark and grading data

Read:
- `{iter_dir}/benchmark.json` — pass rates, per-eval results
- `{iter_dir}/*/with_skill/grading.json` for each eval — especially `expectations`, `eval_feedback`, and `claims`

If `previous_iter_dir` is provided, read its `benchmark.json` too for trend context.

---

## Step 2: Classify the evidence

For each grading signal, classify it into one of these improvement categories:

| Category | Description | Trigger |
|----------|-------------|---------|
| **data-gap** | Agent didn't save data it used — figures in report are unverifiable | `claims` with `verified: false`, grader notes about missing output files |
| **instruction-gap** | Skill says to do something but agents skip or misinterpret it | Assertion consistently fails, grader notes "not included", "footnote only" |
| **assertion-weak** | An assertion that would pass for a clearly wrong output | Grader's `eval_feedback.suggestions` notes "too easy", "trivially satisfied" |
| **assertion-missing** | An important outcome has no assertion | Grader notes a gap without a corresponding failing assertion |
| **fabrication-risk** | Numbers in the report couldn't be verified against saved data | `claims` with `verified: false` and no corresponding file in `outputs/` |
| **design-drift** | Reports don't follow the prescribed design system | Structural observations from grader or analyzer |

---

## Step 3: For each finding, draft a specific proposal

For each classified finding, produce a proposal block with:

1. **Evidence**: Exact quote or paraphrase from `grading.json`
2. **Category**: one of the six above
3. **Eval(s) affected**: which evals showed this
4. **Priority**: HIGH (assertion failed, fabrication risk) / MED (assertion weak, instruction gap) / LOW (assertion missing, minor drift)
5. **Proposed change**: a concrete before/after block showing what to change in `SKILL.md` **or** `evals/evals.json`

Only propose changes with clear evidence — do not invent problems.

### Before/after format

```
### [Priority] Title of finding

**Evidence**: "grader quote or observation"
**Category**: data-gap
**Affects**: vite-audit, agent-config-context

**Current** (`SKILL.md` Step 4 or `evals.json` eval 1):
> [paste the relevant existing text]

**Proposed**:
> [paste the replacement text]

**Why**: one sentence explaining what failure this prevents.
```

---

## Step 4: Prioritize and order

Order proposals:
1. HIGH priority first
2. Within same priority, data-gap and fabrication-risk before instruction-gap, assertion-weak last
3. If the same change fixes multiple evals, merge into one proposal

---

## Step 5: Write skill_improvements.md

Write to `{output_path}`:

```markdown
# Skill Improvement Proposals — iteration-N

Generated from: {iter_dir}
Benchmark pass rate: {X}% (previous: {Y}% if available)
Evals analyzed: vite-audit, agent-config-context, facebook-react

## Summary

{1-2 sentence overview of the most important findings}

## Proposals

{one block per proposal, ordered by priority}

## What to leave alone

{1-3 things working well that should not be changed}
```

---

## What NOT to propose

- Changes that would make evals easier without improving the skill
- Style or wording changes with no behavior impact
- Anything that isn't directly supported by evidence in the grading data
- Changes already applied in a previous iteration (check the skill's current text before proposing)

---

## Completion

Print: `PROPOSALS: {N} proposals written to {output_path}  (HIGH={h}, MED={m}, LOW={l})`
