import { defineConfig } from "vitest/config";

// Where TypeScript lives (see docs/testing.md): repo tooling in scripts/ts/,
// plugin-owned scripts in plugins/<plugin>/scripts/ts/. Keep this in step
// with tsconfig.json `include` and the `lint` script in package.json.
const TS_SOURCES = ["scripts/ts/**/*.ts", "plugins/*/scripts/ts/**/*.ts"];
const TS_TESTS = [
  "scripts/ts/**/*.test.ts",
  "plugins/*/scripts/ts/**/*.test.ts",
];

export default defineConfig({
  test: {
    include: TS_TESTS,
    // Random order surfaces order-dependent flakes.
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: TS_SOURCES,
      exclude: ["**/*.test.ts"],
      // The single owner of the coverage floor. A MEASURED baseline, not a
      // target: the last honest measurement was 96.8% lines (scripts/ts only;
      // no plugin TypeScript existed yet), so 90 leaves headroom without
      // letting a new untested file slide in. Raise it deliberately.
      thresholds: { lines: 90 },
    },
  },
});
