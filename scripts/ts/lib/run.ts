import { writeSync } from "node:fs";
import {
  cliError,
  EXIT_INTERNAL,
  EXIT_OK,
  type CliError,
  type ExitCode,
} from "./exit-codes.ts";
import { readTextFile, type ReadFile } from "./fs.ts";
import { pipe } from "./pipe.ts";
import { andThen, fromThrowable, match, type Result } from "./result.ts";
import { describeThrown } from "./thrown.ts";

/** Environment variables, as `process.env` exposes them. */
export type Env = Readonly<Record<string, string | undefined>>;

/** The effects a command may use. The only impure surface of a CLI. */
export interface Effects {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly exit: (code: ExitCode) => void;
  readonly readFile: ReadFile;
}

/**
 * A command's logic. Pure apart from the injected `readFile`: `ok(text)` is
 * written to stdout and exits 0; `err({ code, message })` writes `message` to
 * stderr and exits with `code`. Findings that should fail the run (lint
 * violations) are an `err` with `EXIT_FAILURE`, not an `ok`.
 */
export type Main = (
  argv: readonly string[],
  env: Env,
  io: Pick<Effects, "readFile">,
) => Result<CliError, string>;

/** Real effects. Synchronous writes so `exit` cannot truncate output. */
export const nodeEffects: Effects = {
  stdout: (text) => {
    writeSync(1, text);
  },
  stderr: (text) => {
    writeSync(2, text);
  },
  exit: (code) => {
    process.exit(code);
  },
  readFile: readTextFile,
};

/**
 * Run `main` against explicit effects: print, map the Result to an exit code,
 * exit. A throw from `main` is a bug and becomes `EXIT_INTERNAL`. This is the
 * testable core of `run`.
 */
export const execute = (
  main: Main,
  argv: readonly string[],
  env: Env,
  effects: Effects,
): void => {
  const code = pipe(
    fromThrowable(
      () => main(argv, env, effects),
      (thrown) =>
        cliError(EXIT_INTERNAL, `internal error: ${describeThrown(thrown)}`),
    ),
    andThen((r: Result<CliError, string>) => r),
    match(
      (e): ExitCode => {
        effects.stderr(`${e.message}\n`);
        return e.code;
      },
      (text): ExitCode => {
        effects.stdout(text);
        return EXIT_OK;
      },
    ),
  );
  effects.exit(code);
};

/**
 * The CLI entrypoint: the ONE place that touches process argv/env, writes
 * output and calls `process.exit`. Everything else is a pure function.
 *
 * ```ts
 * if (import.meta.main) run(main);
 * ```
 */
export const run = (main: Main): void => {
  execute(main, process.argv.slice(2), process.env, nodeEffects);
};
