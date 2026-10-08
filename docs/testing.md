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

`pnpm run check-vitest-flags` fails when a flag documented here, in `.claude/rules/vitest.md`
or in the `plugins/vitest` skills is missing from `vitest --help` on the pinned version;
`pnpm run check-vitest-v3-names` fails on a Vitest 3 pool option or env name in `plugins/`,
`docs/` or `.claude/` unless the same line says it was removed or renamed (the list is in
`scripts/ts/vitest-guards.ts`). Both run in the typescript CI job.

Sharding splits test files, not test cases; combine `--reporter=blob` with
`--shard`, then `--merge-reports` ([Vitest performance
guide](https://vitest.dev/guide/improving-performance)).

## Functional core (`scripts/ts/lib/`)

`lib/` holds the `Result`/`pipe` library and is the lint-enforced "core": no
`let`, loops, classes, `this`, `throw`, or mutation, and parameters/types must be
readonly (`eslint-plugin-functional`, scoped in `eslint.config.js`; add a
directory to `CORE_FILES` there to opt it in). Its tests use
[fast-check](https://fast-check.dev) property tests for the functor/monad laws.

## Where TypeScript lives

| Location | Holds |
|---|---|
| `scripts/ts/` | Repo tooling: lints and checks that guard the repo as a whole |
| `plugins/<plugin>/scripts/ts/` | A script that belongs to one plugin (a lint of that plugin's own files, a helper its skills call) |
| `**/lib/` under either | The functional core (see above); `plugins/*/scripts/ts/lib/` is linted like `scripts/ts/lib/` |

Put a script next to the thing it checks or serves. Tests are `*.test.ts` beside
the source. `vitest.config.ts` (tests and coverage), `tsconfig.json` (typecheck) and
the `lint` script in `package.json` (eslint) all cover both locations, and one
coverage floor applies to the union. When adding a third location, update all
three together.

A plugin is installed on its own, so a script that ships with it and runs on a
user's machine must not import from `scripts/ts/lib/`. Scripts that only run in
this repo (CI lints) may.

## CLI helpers (`scripts/ts/lib/`)

A command is a pure function plus one tiny entrypoint:

- `exit-codes.ts`: `EXIT_OK` 0, `EXIT_FAILURE` 1, `EXIT_USAGE` 2, `EXIT_CONFIG` 3,
  `EXIT_DEPENDENCY` 4, `EXIT_NETWORK` 5, `EXIT_TIMEOUT` 6, `EXIT_PARTIAL` 7, `EXIT_INTERNAL` 20, `EXIT_INTERRUPTED` 130,
  `EXIT_TERMINATED` 143, the same taxonomy as `claude/conventions/shell-script-hygiene.md`.
- `args.ts`: `parseArgs(spec, argv)` returns `Result<CliError, Parsed>`; `-h`/`--help`
  anywhere before `--` yields `{ kind: "help" }` before anything else is validated.
- `fs.ts`: `readTextFile(path)` returns `Result<CliError, string>`.
- `run.ts`: `run(main)` is the only code that touches `process.argv`/`env`, writes
  output and calls `process.exit`. `main(argv, env, io)` returns
  `Result<CliError, string>`: `ok(text)` goes to stdout (exit 0), `err({ code, message })`
  to stderr (exit `code`). A throw from `main` becomes `EXIT_INTERNAL`. Tests call
  `execute(main, argv, env, fakeEffects)` instead.

Worked example, a check that fails on lines containing `TODO`. The logic is a pure
function of the file contents; `main` wires it; the entrypoint is one line:

```ts
// scripts/ts/check-todo.ts
import { parseArgs, type Parsed } from "./lib/args.ts";
import { cliError, EXIT_FAILURE } from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, err, ok } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";

const USAGE = "Usage: check-todo.ts [-h|--help] FILE\n";

/** Pure: file contents to violation messages. */
export const findTodos = (text: string): readonly string[] =>
  text
    .split("\n")
    .flatMap((line, i) =>
      line.includes("TODO") ? [`line ${String(i + 1)}: ${line}`] : [],
    );

const report = (found: readonly string[]) =>
  found.length === 0 ? ok("") : err(cliError(EXIT_FAILURE, found.join("\n")));

export const main: Main = (argv, _env, io) =>
  pipe(
    parseArgs({ usage: USAGE, minPositionals: 1, maxPositionals: 1 }, argv),
    andThen((parsed: Parsed) =>
      parsed.kind === "help"
        ? ok(parsed.usage)
        : pipe(
            io.readFile(parsed.positionals[0] ?? ""),
            andThen((text: string) => report(findTodos(text))),
          ),
    ),
  );

if (import.meta.main) run(main);
```

Test `findTodos` directly and `main` with a fake `io.readFile`; no process, no
files. Wiring it into CI: see the "Ported check" note in `docs/contributing.md`.
