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

Sharding splits test files, not test cases; combine `--reporter=blob` with
`--shard`, then `--merge-reports` ([Vitest performance
guide](https://vitest.dev/guide/improving-performance)).

## Functional core (`scripts/ts/lib/`)

`lib/` holds the `Result`/`pipe` library and is the lint-enforced "core": no
`let`, loops, classes, `this`, `throw`, or mutation, and parameters/types must be
readonly (`eslint-plugin-functional`, scoped in `eslint.config.js`; add a
directory to `CORE_FILES` there to opt it in). Its tests use
[fast-check](https://fast-check.dev) property tests for the functor/monad laws.
