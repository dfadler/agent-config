import { readFileSync } from "node:fs";
import { cliError, EXIT_FAILURE, type CliError } from "./exit-codes.ts";
import { fromThrowable, type Result } from "./result.ts";
import { describeThrown } from "./thrown.ts";

/** Reads a UTF-8 file; the effectful edge a pure `main` receives injected. */
export type ReadFile = (path: string) => Result<CliError, string>;

/**
 * Read a UTF-8 text file. A missing or unreadable file is an `err` carrying
 * `EXIT_FAILURE` and a message naming the path, never a throw.
 */
export const readTextFile: ReadFile = (path) =>
  fromThrowable(
    () => readFileSync(path, "utf8"),
    (thrown) =>
      cliError(EXIT_FAILURE, `cannot read ${path}: ${describeThrown(thrown)}`),
  );
