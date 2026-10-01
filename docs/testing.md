# Testing the TypeScript scripts

Tests under `scripts/ts/` run on [Vitest](https://vitest.dev) (config:
`vitest.config.ts`). Use `pnpm`, not `npx`.

```bash
pnpm test        # vitest run
pnpm coverage    # vitest run --coverage, 90% line floor (v8)
```

Test order is shuffled by default (`sequence.shuffle`) to surface
order-dependent flakes. Vitest prints the seed on a failing run; replay that
order with `--sequence.seed=<n>`.

## Hunting a flaky test

The step-by-step procedure lives in the `vitest:flaky-tests` skill (and the
`flaky-test-investigator` agent in `plugins/vitest/`); `.claude/rules/vitest.md`
loads the short rules whenever Claude touches a test file. The flags:

Flags are from the [Vitest CLI docs](https://vitest.dev/guide/cli.html) and
[`maxWorkers`](https://vitest.dev/config/maxworkers). Extra args go straight
after the pnpm script name; don't insert a `--`, because the flags after it
were silently ignored when tried here.

```bash
# Stress-run one file: each test runs 1 + 100 times
pnpm test scripts/ts/foo.test.ts --repeats=100

# Replay a specific shuffle order
pnpm test --sequence.seed=12345

# Mimic a 2-core CI runner (replaces the old poolOptions.*.maxThreads/maxForks)
pnpm test --maxWorkers=2

# Fully serial, no cross-file parallelism
pnpm test --no-file-parallelism --maxWorkers=1
```

## Simulating CI memory and CPU limits

```bash
# Cap the V8 heap at 512 MB for the Vitest process (forks pool is the default)
NODE_OPTIONS=--max-old-space-size=512 pnpm test

# Most realistic: a container limited to 0.5 CPU / 512 MB
docker run --rm --cpus=0.5 --memory=512m -v "$PWD":/app -w /app \
  node:22 sh -c 'corepack enable && pnpm install --frozen-lockfile && pnpm test'
```

`NODE_OPTIONS` is inherited by worker processes; passing
`--max-old-space-size` to `node` directly would only cap the parent. If a
flake only reproduces in CI, compare the CI job's core count with
`--maxWorkers` first.
