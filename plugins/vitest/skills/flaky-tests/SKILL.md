---
name: flaky-tests
description: |
  Reproduce and diagnose a flaky Vitest test: one that fails intermittently, only in
  CI, or only in a certain order. Use when a test passes locally but fails in CI, when
  asked to "stress-run", "repeat", "shuffle", or "replay the seed" for tests, or to
  simulate CI CPU/memory limits for Vitest. Not for deterministic failures.
metadata:
  version: "1.0.0"
---

# Hunting a flaky Vitest test

Use the project's package manager to invoke Vitest (e.g. `pnpm test`, `pnpm vitest run`),
and put flags directly after the command. A `--` separator made Vitest ignore the
flags that followed it when tried on pnpm.

Work down the ladder; stop at the first rung that reproduces the failure.

1. **Get the failing run's facts.** Note the test file, the error, and the shuffle
   seed (Vitest prints `Running tests with seed "<n>"`). Compare the CI job's core
   count and Node version with local.
2. **Replay the order.** `vitest run --sequence.seed=<n>`. A reproduction means an
   order dependency: shared module state, a leaked mock/timer/env var, a fixture
   written by an earlier test.
3. **Stress the single file.** `vitest run path/to/file.test.ts --repeats=100`.
   `--repeats=N` runs each test 1+N times. Fails here but not in step 2: timing,
   randomness, or a real race inside the test itself.
4. **Shuffle across seeds.** Run a few fresh seeds; add `--sequence.shuffle.tests`
   if the config does not already shuffle.
5. **Constrain concurrency.** `--maxWorkers=2` (or `--maxWorkers=1
   --no-file-parallelism`) to mimic a small CI runner. Fails only constrained: a
   timeout too tight, or tests contending for a port, directory, or temp file.
6. **Constrain memory.** `NODE_OPTIONS=--max-old-space-size=512 vitest run`. Use
   `NODE_OPTIONS` so worker processes inherit the cap; passing the flag to `node`
   only caps the parent. For CPU too, run in a container with `--cpus=0.5 --memory=512m`.

`poolOptions.threads.maxThreads` / `poolOptions.forks.maxForks` are not in the
Vitest 5 CLI docs; use `--maxWorkers`. Check any other flag with `vitest --help` for
the installed version before relying on it.

## Fixing

Fix the cause, not the symptom. Common causes and fixes: state not reset (reset in
`beforeEach`, `vi.restoreAllMocks`, `vi.useRealTimers`), wall-clock or `Math.random`
dependence (fake timers, seeded input), shared temp paths (per-test unique dirs),
unawaited promises (await or assert on them). Do not "fix" with `retry` or a longer
timeout unless you can say why that is the actual cause. After the fix, re-run the
command from the rung that failed and confirm it passes.
