---
name: a11y-review
description: |
  Static, dependency-free WCAG 2.2 code review for web markup (HTML, JSX, Vue,
  Svelte, Astro) and CSS. Checks source against the a11yproject.com checklist
  (mapped to WCAG 2.2 success criteria) and grades each finding by evidence basis
  (verified / flagged / human-required) and severity (critical/serious/moderate/
  minor). No browser, no npm CLI, no network access — pure Read/Grep over source,
  so it works in any repo immediately. Use for "review this component for
  accessibility", "check this page/PR for a11y issues", "is this markup WCAG
  compliant", or before merging a UI change. It cannot verify computed contrast,
  actual keyboard/screen-reader behavior, or anything needing a rendered page —
  those get flagged for a real scanner (e.g. axe-core) or human/AT testing, not
  guessed at.
argument-hint: "[file|directory|diff] [--level AA|AAA]"
allowed-tools: Read, Grep, Glob, Bash
license: Apache-2.0
metadata:
  version: "0.1.0"
---

Adapted from [The A11Y Project](https://www.a11yproject.com/checklist/) (checklist
content, Apache-2.0) and [AccessLint](https://github.com/AccessLint/skills)
(evidence-basis/severity grading approach, MIT). See `../../NOTICE.md` for
provenance.

This skill locates and grades; it doesn't fix (hand findings to the user or a
follow-up edit) and it doesn't scan a live page (hand that to axe-core or a
browser-based tool). Say which you did and didn't do.

## Reference material

- [`references/checklist.md`](references/checklist.md) — the WCAG 2.2 checklist
  items, organized by content area (images, headings, forms, color contrast,
  etc.), each mapped to its success criterion. Grep it for a keyword rather than
  reading it end to end.
- [`references/grading.md`](references/grading.md) — the evidence-basis (●/◐/○)
  and severity grading rules, adapted for what static source alone can support.
  Read it before writing findings; the rules that always apply are summarized
  below.

## Grading, in brief

Every finding gets two independent grades:

- **Evidence basis**: ● verified (a deterministic fact from source that's also a
  real conformance failure: a missing attribute, wrong element, positive
  `tabindex`) · ◐ flagged (real evidence, but confirming the failure needs
  computed styles, a rendered page, or a judgment call — a heading-rank skip or
  `autofocus` is a verifiable *fact* but not an automatic failure, see
  `references/checklist.md`'s Advisory section) · ○ human-required (needs a
  screen reader or lived experience).
- **Severity**: critical (blocks a core task) · serious (major barrier) ·
  moderate (friction, still completable) · minor (polish).

When unsure between two evidence grades, use the lower one. Full definitions and
worked examples are in `references/grading.md`.

## Procedure

1. **Scope.** `$ARGUMENTS` is a file, directory, or diff (`git diff`, a PR's
   changed files) to review, plus an optional `--level AA|AAA` (default AA — AAA
   items in the checklist are still worth flagging as informational at AA).
   Given nothing, ask what to review rather than sweeping the whole repo
   unprompted.
2. **Read the target.** For a diff, review the changed lines plus enough
   surrounding markup to judge structure (a changed `<div>` needs its parent to
   judge heading/landmark context). For a directory, find markup/template files
   via Glob rather than assuming a framework.
3. **Check against the checklist.** Work through `references/checklist.md` by
   category, but only the categories relevant to what's actually present in the
   target (no `<table>` in the diff → skip the Tables section; note it as N/A,
   not silently dropped). Grep the source for the syntactic signals each item
   implies (missing `alt=`, `<div onClick`, un-labeled `<input`, skipped heading
   levels, `autofocus`, positive `tabindex`, literal low-contrast color pairs)
   rather than reading every line by eye.
4. **Grade each finding** per `references/grading.md`. Cite file:line and the
   exact snippet for every finding; never fabricate a location.
5. **Report.**

```
# Accessibility review — <target>
WCAG 2.2 Level <AA|AAA> · static source review (no browser, no live scan)

Severity: <c> critical · <s> serious · <m> moderate · <n> minor
Basis: ● <v> verified · ◐ <f> flagged · ○ <h> human-required
Checklist categories reviewed: <list>   ·   N/A (not present in target): <list>

## ● Verified
- [severity] <what> — SC <x.x.x>
    where: <file>:<line> — `<snippet>`
    fix: <mechanical change> | TODO(<SC>): needs judgment (<what a human decides>)

## ◐ Flagged
- [severity] <what> — SC <x.x.x>
    where: <file>:<line> — `<snippet>`
    confirm with: <specific check — e.g. "axe-core color-contrast rule", "render at 200% zoom">

## ○ Human-required
- <what only AT or lived experience reveals> — SC <x.x.x>
    needs: <functional ability + assistive technology>
    where: <file>:<line> (context, not proof)

## Not covered by this review
- Computed contrast, actual keyboard/screen-reader behavior, anything needing a
  rendered page — recommend axe-core/Lighthouse and human/AT testing for these.
```

Spend the report's words on findings and handoffs; a clean category is its name
in "reviewed," not a paragraph. Don't let "not present in target" (N/A) or "not
covered by this review" read as "passed" — they're honestly different things.

## Notes

- This skill never edits files. For remediation, hand the ● findings' mechanical
  fixes to a normal edit, and leave the TODOs for a human.
- For live-DOM scanning (real contrast, real keyboard traps, real screen-reader
  output), recommend axe-core (open-source) in CI/Playwright, or a manual
  keyboard-and-screen-reader pass — don't simulate what only a browser or a
  person can confirm.
