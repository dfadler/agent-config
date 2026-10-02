import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/ts/**/*.test.ts"],
    // Random order surfaces order-dependent flakes.
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["scripts/ts/**/*.ts"],
      exclude: ["**/*.test.ts"],
      // The single owner of the coverage floor.
      thresholds: { lines: 90 },
    },
  },
});
