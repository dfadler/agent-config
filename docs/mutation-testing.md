# Mutation testing (StrykerJS)

[StrykerJS](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) mutates the
source and reports mutants the tests do not kill. It automates the manual check in
`claude/conventions/testing-sabotage-check.md` for the TypeScript scripts (not bats).
Config: `stryker.config.json`. Background and trial numbers: issue #995 and PR #1014.

Run it on demand, on the files whose tests you changed (Node 24). Use `pnpm`, not
`npx`, and put no `--` before the flags: pnpm 11 passes it on to Stryker, which then
fails with "too many arguments for 'run'".

```bash
pnpm run mutate --mutate plugins/eval-authoring/scripts/ts/run-evals/power.ts
```

- Incremental mode is on: a rerun reuses results from `reports/stryker-incremental.json`
  and only re-runs what changed ([docs](https://stryker-mutator.io/docs/stryker-js/incremental/)).
  It misses changes outside mutated and test files; add `--force` to re-run everything.
- Read the boundary and logic survivors (`<=`, `>`, `&&`/`||`). String-literal survivors and
  code no test reaches are mostly noise.
- Locally the TypeScript checker is off. The scheduled workflow turns it on with
  `--checkers typescript`; it discards mutants that do not compile, at the cost of a slower run.
- `.github/workflows/mutation.yml` is weekly (and manual), standalone and non-gating: it
  restores the incremental file from the Actions cache, does a full `--force` run on the
  first Monday of the month, and uploads the report as an artifact. It is not part of
  `all-checks`; do not run Stryker per PR.
- Pool: no change needed. Vitest 5's default pool is already `forks`; setting it explicitly
  gave identical results and `threads` was no faster (#1020).
- Whole tree (`pnpm run mutate`, no override; #1018): 25,757 mutants in 161 files, about 48 min on a
  12-core Mac with 11 runners, score 72.10% (17,057 killed, 371 timeout, 5,131 survived, 1,612 no
  coverage). Plain `pnpm run mutate` does not get through the dry run yet; see the #1018 comment
  for the four test and config changes it needed. Practical as a scheduled job, not per change.
