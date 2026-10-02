# Testing the TypeScript scripts

Tests under `scripts/ts/` run on [Vitest](https://vitest.dev) (config:
`vitest.config.ts`, which also owns the coverage floor and turns on shuffled test
order). Use `pnpm`, not `npx`.

```bash
pnpm test        # vitest run
pnpm coverage    # vitest run --coverage; fails below the thresholds in vitest.config.ts
```

Test order is shuffled by default (`sequence.shuffle`), so the seed alone replays a
failing order in this repo.

The procedure for reproducing a flaky test (seed replay, repeats, CI worker and
memory limits, and how to forward flags per package manager) lives in one place: the
`vitest:flaky-tests` skill in `plugins/vitest/`.
