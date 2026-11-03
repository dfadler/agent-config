# Worked example: one skill, two cases

A made-up skill `release-notes` ("Turn a git changelog into release notes. Use when asked to
write release notes from commits or a CHANGELOG."). Two cases cover its trigger boundary:
one prompt that should fire it, one near-miss that should not. Graders are free first; the
single `llm` grader judges tone, which no pattern can.

## Should fire

```yaml
# good-reply: Heads up: in 2.0 the --legacy flag is gone, so switch to the new default. You also get dark mode, and the crash on an empty config is fixed.
# bad-reply: Release 2.0 adds dark mode and fixes a crash on empty config.
schema_version: "1.1"
name: release-notes-fires-on-changelog
description: >
  A changelog with a breaking change should fire release-notes and produce notes that name
  it. expected_outcome: PASS when the skill is invoked and the reply names the breaking
  change in a friendly tone; FAIL otherwise.
tags: [release-notes, trigger]

execution:
  prompt: |
    Here is our CHANGELOG for 2.0. Turn it into release notes for users.

    - feat: add dark mode
    - BREAKING: remove the --legacy flag
    - fix: crash on empty config
  max_turns: 6
  allowed_tools:
    - Skill

graders:
  # Steps (tool_used): the skill fired on a prompt that never names it. Unscored in a
  # two-arm run, so it is an indicator, not the delta.
  - name: skill_fired
    type: tool_used
    tool: Skill
    input_match: '"skill"\s*:\s*"(?:[\w-]+:)?release-notes"'
    min: 1

  # Result (regex): the breaking change is named. Free, and it can fail: a generic summary
  # often drops the flag name.
  - name: names_breaking_change
    type: regex
    target: last_message
    pattern: '--legacy'
    match: contains

  # Result (llm, last): semantic tone. Concrete PASS and FAIL wording so two judges agree.
  - name: friendly_tone
    type: llm
    criteria: >
      PASS if the notes address the reader directly or use plain, warm wording, and the
      breaking change appears with a sentence on what to do instead.
      FAIL if the notes are a bare bullet list copied from the changelog, or the breaking
      change appears with no guidance.
```

## Near-miss (must not fire)

Shares the vocabulary ("changelog", "release") but wants something else:

```yaml
schema_version: "1.1"
name: release-notes-quiet-on-changelog-lint
description: >
  A request to check CHANGELOG formatting must not fire release-notes. A trigger-boundary
  negative: counted by `run-evals --trigger-boundary`, plugin arm only, so no delta.
tags: [release-notes, trigger-boundary, "pair:release-notes-fires-on-changelog"]

execution:
  prompt: |
    Is this CHANGELOG entry valid Keep a Changelog format? "## 2.0 - added dark mode"
  max_turns: 4
  allowed_tools:
    - Skill

graders:
  # min: 0 is explicit (tool_used defaults min to 1). No arm: the negative runs plugin-arm
  # only. To keep it in the two-arm run as a cheap `smoke` guard instead, add `arm: both`
  # and drop the trigger-boundary tags.
  - name: release_notes_not_invoked
    type: tool_used
    tool: Skill
    input_match: '"skill"\s*:\s*"(?:[\w-]+:)?release-notes"'
    min: 0
    max: 0
```

Neither case needs a grant: `allowed_tools` lists only `Skill`. The lint's opt-in EVAL009
(`--enable EVAL009`) would report only the near-miss, which has no result grader by design.
