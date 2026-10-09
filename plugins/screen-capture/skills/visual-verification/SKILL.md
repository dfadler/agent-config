---
name: visual-verification
description: |
  Policy for when before/after screenshots are required on a PR or issue, and
  how to kick off the capture pipeline. Load when finishing a PR that alters
  visually rendered output (UI components, generated images/diagrams, styled
  documents). Skip for changes with no rendered output: backend logic, config,
  migrations, scripts, tests, types, docs, tooling.
license: MIT
metadata:
  version: "1.0.0"
---

# Visual verification policy

## When it's required

When a PR or issue alters what gets visually rendered — UI components,
generated images/diagrams, styled documents, anything a human would look at
rather than just read as code — provide before/after screenshots in the PR or
issue description, not just a prose description of the change.

Do this proactively, without waiting to be asked — treat it as part of
finishing the PR, the same way running the test suite is.

**Skip** for changes that don't affect rendered output: backend logic, config,
migrations, scripts, tests, types, docs, tooling.

## For responsive / layout changes

A screenshot at one fixed width isn't sufficient proof for changes that touch
layout, CSS, or responsive behavior — it can look fine while missing overflow,
clipping, or dead space that only shows up at a different viewport width.

Do a manual resize pass across representative breakpoints **plus** a Lighthouse
CLI pass (when `lighthouse_enabled` is on, for the configured form factors) as
part of the verification; see the `screen-capture:lighthouse` skill for the
invocation and config.

## Capture pipeline

Run these skills in order:

1. `screen-capture:capture` — render before/after, convert to PNG, crop to
   content, avoiding false negatives from shared-page style leakage or
   host-context-only effects
2. `screen-capture:compare` — produce the before/after comparison
3. `screen-capture:attach` — upload and format the PR/issue body, verifying
   the images resolve
