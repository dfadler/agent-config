---
status: proposed
---

# Eval case values are the CLI loader's to judge; we mirror no enums

`plugins/eval-authoring` does not keep its own table of legal case values (grader `arm` and `type`, `weight`, `max_turns`, `runs`, `timeout_seconds`, `match`). The `claude plugin eval` loader decides them, and `run-evals.ts` asks it once per suite, before any plan or dry-run output, with `claude plugin eval --max-cost-usd 0`. The unused `oneOf` in `parser/schema.ts` and its type in `parser/types.ts` are removed, not made live. EVAL003 stays deleted (commit `e0e64670`, [docs/lint-rules.md](../../plugins/eval-authoring/docs/lint-rules.md)).

Why: a mirrored table drifts from the CLI. The `oneOf` was never read, so `arm: with` passed lint and `run-evals.ts --dry-run` and failed only in the paid run. A table that nothing enforces gives false assurance, and one that does enforce it can reject values a newer CLI accepts.

## Decision

- **Pre-flight, per suite.** One loader call per suite in `run-evals.ts`. Only the loader's own "invalid case.yaml" verdict blocks. If the CLI is missing, logged out or crashes, the verdict is "unchecked": warn and continue (a paid run needs the CLI anyway).
- **Parse the output, not the exit code.** Under `--max-cost-usd 0` the exit code is 2 for a bad suite and a clean one alike (the $0 ceiling is hit first; probed on CLI 2.1.321). The adapter reads the `✗ <path>: invalid case.yaml: ...` lines and the `N case file(s) failed to load` footer.
- **Refuse on parser issues.** `run-evals` refuses to plan, dry-run included, when `suite.issues` is non-empty. `--allow-issues` is the escape. After this, `suite.issues` is empty or the run never started.
- **Parser issues are about our own limits.** `readSuite` records values our tools cannot process (an invalid regex pattern, unparseable flags). It never records a value for being out of range; that stays the loader's call.
- **One vocabulary, no validation.** The parser exports the names our tools branch on (arms, grader types, regex flags, match modes) as typed constants. Nothing is validated against them, and consumers treat "not in the vocabulary" as an explicit unknown state, not a default. Today an unknown arm silently scores as "both".

## Considered options

- **Make the `oneOf` live** (parser records value issues). Rejected: it duplicates the loader and drifts, the reason EVAL003 was deleted.
- **Restore EVAL003** (lint rule). Rejected for the same reason. The edit-time hook still misses `arm: with`, a known trade-off: the hook must stay fast and offline.
- **Run the loader in the edit-time hook or in lint.** Rejected: it shells out to a CLI that may be absent in CI.
- **Rely on the exit code.** Rejected: it does not distinguish bad from clean at a $0 ceiling.

## Consequences

- The loader's wording is now an interface. A CLI release that changes the `✗ ... invalid case.yaml` line format turns the pre-flight into "unchecked" (a warning) until the adapter is updated. A fake-loader test pins the format we parse.
- [docs/lint-rules.md](../../plugins/eval-authoring/docs/lint-rules.md) needs its EVAL003 note amended: value checks live in the run-evals pre-flight, and its "exit 1" claim does not hold at `--max-cost-usd 0`.
- Not probed: the loader with the CLI logged out, or on an untrusted plugin directory without `--trust-plugin`. Both should map to "unchecked".
