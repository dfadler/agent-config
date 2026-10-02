# Testing the TypeScript scripts

Tests under `scripts/ts/` run on [Vitest](https://vitest.dev) (config:
`vitest.config.ts`, which also owns the coverage floor and turns on shuffled test
order). Use `pnpm`, not `npx`.

```bash
pnpm test        # vitest run
pnpm coverage    # vitest run --coverage; fails below the thresholds in vitest.config.ts
```

Flaky-test flags ([Vitest CLI docs](https://vitest.dev/guide/cli.html)); the ladder
for using them, and package-manager forwarding, is the `vitest:flaky-tests` skill:

| Flag | Effect |
|---|---|
| `--repeats=N` | Run each test 1+N times |
| `--sequence.shuffle.tests --sequence.seed=<n>` | Replay a shuffled order (the seed is ignored unless shuffling is on) |
| `--maxWorkers=N` / `--no-file-parallelism` | Limit worker count / run files serially |
| `NODE_OPTIONS=--max-old-space-size=512` | Cap the V8 heap of the run and its workers |
