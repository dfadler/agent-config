## Favor tooling over manual scanning

When a task calls for checking many things — a codebase-wide convention, every
caller of a changed signature, whether a file is still referenced — reach for an
automated tool (grep, a linter, a type checker, the test suite, a codemod) before
reading through files by hand. A tool checks exhaustively and doesn't get tired
partway through; manual scanning can miss items and stop partway through.

- After a change, run the smallest check that actually exercises it — a focused
  test, the specific command that was edited — rather than a full suite by default.
- Only widen scope once something's actually off: a whole-file read, a check of
  sibling/related files, an effective-config dump. A persisting error, a behavior
  mismatch, or a flaky result is grounds to widen it; doing so preemptively isn't.
- Prefer a tool's autofix pass over a manual cleanup when a safe autofixer exists.
  If the autofix changes semantics or adds unwanted noise, revert it and fix by
  hand instead.

