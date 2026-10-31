# Worked example: one skill, two cases

A made-up skill `release-notes` ("Turn a git changelog into release notes. Use when asked to
write release notes from commits or a CHANGELOG."). Two cases cover its trigger boundary:
one prompt that should fire it, one near-miss that should not. Graders are free first; the
single `llm` grader judges tone, which no pattern can.

## Should fire

```yaml
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
  A request to check CHANGELOG formatting must not fire release-notes. A regression guard:
  the no-plugin arm passes too, so there is no delta by design.
tags: [release-notes, trigger]

execution:
  prompt: |
    Is this CHANGELOG entry valid Keep a Changelog format? "## 2.0 - added dark mode"
  max_turns: 4
  allowed_tools:
    - Skill

graders:
  # min: 0 is explicit (tool_used defaults min to 1); arm: both so the check is scored.
  - name: release_notes_not_invoked
    type: tool_used
    tool: Skill
    input_match: '"skill"\s*:\s*"(?:[\w-]+:)?release-notes"'
    min: 0
    max: 0
    arm: both
```

Neither case needs a grant: `allowed_tools` lists only `Skill`. The lint's opt-in EVAL009 (`--enable EVAL009`) would report both: a reply-only skill has no
scored steps grader, which is expected (see step 4).
