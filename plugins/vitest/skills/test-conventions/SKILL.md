---
name: test-conventions
description: |
  Conventions for writing or editing Vitest tests (`*.test.ts`, `*.spec.ts`) and
  `vitest.config.ts`: isolation under shuffled order, determinism, mock hygiene, and
  coverage thresholds. Use when adding or changing a Vitest test or its config. For
  Vite plugin hook tests use `vite:test`; for flaky failures use `flaky-tests`.
metadata:
  version: "1.0.0"
---

# Writing Vitest tests

Assume tests run in random order and in parallel workers; a suite that only passes in
file order is a flaky suite waiting for CI.

- **Each test sets up what it needs.** No test reads state another test wrote. Put
  setup in the test or `beforeEach`; do not rely on declaration order.
- **Reset what you change.** `vi.restoreAllMocks()`, `vi.unstubAllEnvs()`,
  `vi.useRealTimers()` in `afterEach`, or set `restoreMocks` / `unstubEnvs` in config.
  Prefer scoped helpers over mutating `process.env` or globals.
- **No wall-clock or randomness.** Use fake timers and seeded or fixed inputs. Never
  sleep to wait for something; await it or advance fake timers.
- **No shared paths or ports.** Use a unique temp dir per test (`fs.mkdtemp`) and
  port 0 for servers.
- **Await or assert every promise.** Use `await expect(p).resolves` / `.rejects`.
- **Assert behavior, not mocks.** A test whose only assertions are on a mock it
  configured proves nothing. Prefer a real implementation where it is cheap.
- **Spot-check new tests by sabotage.** Temporarily break the code under test,
  confirm the test fails, then revert.
- **Config:** keep `sequence.shuffle` on so order bugs surface early; keep the
  coverage `thresholds` the project set and never lower one to make a run pass. Do
  not add `retry` to hide a flake; use `flaky-tests` to find the cause.
