---
paths:
  - "**/*.test.ts"
  - "**/vitest.config.ts"
---

# Vitest tests

Tests run in shuffled order across parallel workers. Before writing or changing one,
load `vitest:test-conventions`; to reproduce a flaky one, load `vitest:flaky-tests`.
