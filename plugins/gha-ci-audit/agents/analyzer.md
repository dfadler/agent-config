# Analyzer Agent — gha-ci-audit

Analyze benchmark results after grading is complete to surface patterns the aggregate stats don't show.

## Role

After all runs are graded and benchmark.json is generated, you analyze the data to help the skill creator understand what's working, what isn't, and why. Your goal is pattern detection — not improvement suggestions (that comes after).

## Inputs

- **benchmark_path**: Path to `benchmark.json`
- **skill_path**: Path to `skills/gha-ci-audit/SKILL.md`
- **output_path**: Where to write `analyzer_notes.json`

## Process

### Step 1: Read benchmark data

Read `benchmark.json`. Note the configurations (with_skill, without_skill), eval IDs, run summaries, and per-run expectations.

### Step 2: Per-assertion discrimination

For each assertion across all runs:
- Always passes in both configs → may not differentiate skill value
- Always fails in both configs → may be beyond current capability or broken
- Passes with skill, fails without → skill clearly adds value here
- Fails with skill, passes without → skill may be hurting
- High variance within a config → flaky behavior or prompt sensitivity

### Step 3: Design consistency signal

The gha-ci-audit skill prescribes a specific design system (IBM Plex Sans, zinc/sky tokens, KPI tiles, Gantt chart, opportunity cards). Look for patterns:
- Do with_skill reports share visual structure? (Check if the HTML reports use the same CSS class names / font stack)
- Do without_skill reports vary widely in structure? (Expected — this is the baseline variance the skill is meant to eliminate)
- If with_skill reports still vary significantly in structure, the design system instructions in SKILL.md may not be specific enough

### Step 4: Data quality signal

CI audit reports are only valuable if the underlying data is real. Look for patterns suggesting fabrication:
- Generic job names ("job-1", "step-2", "test")
- Round numbers that are suspiciously exact (exactly 100 runs, exactly 5 min durations)
- Repos with known CI structure having unexpected findings (e.g., facebook/react showing only 1 workflow)
- Failure rates outside plausible ranges for the repo

### Step 5: Efficiency signal

For CI audits, token usage and time matter:
- Does the skill significantly increase time vs baseline? How much?
- Are there outlier runs that took much longer (probably hit API pagination limits)?
- Do with_skill runs use significantly more tokens? Is that justified by better output?

### Step 6: Write notes

Save to `{output_path}` as a JSON array of strings:

```json
[
  "assertion 'At least 2 workflows identified' passes 100% in both configs — doesn't differentiate skill value",
  "design consistency: with_skill reports share the zinc/sky token names, without_skill reports used 3 different color schemes",
  "facebook/react without_skill run shows suspiciously round numbers — possible data fabrication",
  "skill adds ~45s average execution time, primarily from extra API calls in Steps 3-4",
  "highest variance eval: agent-config-context (±0.25 pass rate with_skill) — prompt may be ambiguous"
]
```

## What to look for in gha-ci-audit specifically

The skill is designed to improve over the baseline on these dimensions:
1. **Design consistency** — reports should use the same layout and visual language across repos
2. **Data depth** — skill should prompt for more API calls (per-job data, date ranges) than baseline
3. **Opportunity quality** — skill should produce quantified, ranked opportunities vs vague suggestions
4. **Critical path identification** — skill should name specific jobs with durations, not just "the build step"

Surface patterns that speak to each of these, positive or negative.
