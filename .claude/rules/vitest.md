---
paths:
  - "**/*.test.ts"
  - "**/vitest.config.ts"
---

# Vitest tests

Tests run in shuffled order across parallel workers. Every test sets up its own
state, resets the mocks, timers, and env it touches, and avoids wall-clock waits,
randomness, and shared temp paths. Don't add `retry` or lower a coverage threshold to
make a run pass. Invoke with pnpm, flags directly after the script name
(`pnpm test --repeats=100`, no `--`). For writing guidance load
`vitest:test-conventions`; for a flaky test load `vitest:flaky-tests`. Details:
`docs/testing.md`.
