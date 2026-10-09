---
name: testing-sabotage-check
description: |
  Spot-check that a new or modified test would actually catch a regression by
  temporarily breaking the code under test and confirming the test fails.
  Load after writing or modifying a test, or when suspicious that an existing
  test passes vacuously (tautological assertion, implementation-coupled mock,
  existence-only check).
license: MIT
metadata:
  version: "1.0.0"
---

# Testing sabotage / mutation spot-check

A test that passes today isn't proof it would catch a real regression. An
implementation-coupled mock, a tautological assertion, or an existence-only
check can pass vacuously forever.

## Procedure

1. Temporarily break the code under test — comment out the logic, add an
   early return, flip a condition, or return the wrong value.
2. Re-run the test. It should fail.
3. **Revert the breakage immediately** — this is a verification step, not a
   change to ship.

## Scope

Apply selectively to new or modified tests, or to tests you're suspicious of.
Don't run a blanket pass over an entire existing suite. A trivial one-line
test needs no spot-check.

## Why bother

This is cheap: it needs no mutation-testing tool, just the language's own
runner. The technique was used on this repo's own kcov/`check-shell-coverage.sh`
work to confirm bats coverage was real rather than incidental.
