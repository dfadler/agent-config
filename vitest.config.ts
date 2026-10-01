import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/ts/**/*.test.ts"],
    // Random order surfaces order-dependent flakes. Replay a failing order
    // with `--sequence.seed=<n>` (see docs/testing.md).
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["scripts/ts/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // Same 90% line floor the node:test coverage gate enforced.
      thresholds: { lines: 90 },
    },
  },
});
