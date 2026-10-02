import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/ts/**/*.test.ts"],
    // Random order surfaces order-dependent flakes. Replay a failing order
    // with `--sequence.seed=<n>` (see the vitest:flaky-tests skill).
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["scripts/ts/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // The single owner of the coverage floor; same line floor the old node:test gate enforced.
      thresholds: { lines: 90 },
    },
  },
});
