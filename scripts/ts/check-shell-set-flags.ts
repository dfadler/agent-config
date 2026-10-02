// Verify every shell script declares `set -uo pipefail` (or `set -euo
// pipefail`) as its first real statement, and that every shebang'd script is
// chmod +x, unless it carries a `# sourced-only` marker in its header. shellcheck
// has no rule for either. The logic lives in shell-set-flags.ts.
import { accessSync, constants, lstatSync, readdirSync } from "node:fs";
import { parseArgs, type Parsed } from "./lib/args.ts";
import { cliError, EXIT_FAILURE, type CliError } from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, collect, err, fromThrowable, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";
import {
  checkScript,
  formatViolations,
  type Violation,
} from "./shell-set-flags.ts";

const USAGE = `Usage: check-shell-set-flags.ts [-h|--help] [DIR...]

Verify every shell script under DIR (default: scripts plugins setup.sh teardown.sh doctor.sh)
declares \`set -uo pipefail\` (or \`set -euo pipefail\`) as its first real
statement, unless it carries explicit sourced-only evidence: a literal
\`# sourced-only\` comment line in its header (before the first real
statement). A missing shebang alone does NOT grant that exemption.

  -h, --help   Show this message and exit.
`;

const DEFAULT_ROOTS: readonly string[] = [
  "scripts",
  "plugins",
  "setup.sh",
  "teardown.sh",
  "doctor.sh",
];

const SUCCESS =
  "✓ All shell scripts are chmod +x (where shebang'd) and declare set -u.../pipefail as their first statement, unless marked '# sourced-only'.\n";

/** The filesystem facts the check needs; the only impure surface here. */
export interface ShellFs {
  /** Regular `*.sh` files under (or equal to) each root; missing roots are skipped. */
  readonly listShellFiles: (roots: readonly string[]) => readonly string[];
  readonly isExecutable: (path: string) => boolean;
}

const kindOf = (path: string): "file" | "dir" | "other" => {
  try {
    const st = lstatSync(path);
    return st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
  } catch {
    return "other";
  }
};

const walk = (path: string): readonly string[] => {
  const kind = kindOf(path);
  if (kind === "file") return path.endsWith(".sh") ? [path] : [];
  if (kind !== "dir") return [];
  return readdirSync(path)
    .sort()
    .flatMap((entry) => walk(`${path}/${entry}`));
};

/** Real filesystem, mirroring `find ROOT -type f -name '*.sh'` (no symlinks followed). */
export const nodeShellFs: ShellFs = {
  listShellFiles: (roots) => roots.flatMap(walk),
  isExecutable: (path) =>
    fromThrowable(
      () => {
        accessSync(path, constants.X_OK);
        return true;
      },
      () => false,
    ).tag === "ok",
};

const checkOne =
  (fs: ShellFs, readFile: (p: string) => Result<CliError, string>) =>
  (file: string): Result<CliError, readonly Violation[]> =>
    pipe(
      readFile(file),
      andThen(
        (text: string): Result<CliError, readonly Violation[]> =>
          ok(checkScript(file, text, fs.isExecutable(file))),
      ),
    );

const report = (all: readonly (readonly Violation[])[]): Result<CliError, string> => {
  const text = formatViolations(all.flat());
  return text === undefined ? ok(SUCCESS) : err(cliError(EXIT_FAILURE, text));
};

/** Build the command around a filesystem, so tests can inject a fake one. */
export const makeMain =
  (fs: ShellFs): Main =>
  (argv, _env, io) =>
    pipe(
      parseArgs({ usage: USAGE }, argv),
      andThen((parsed: Parsed): Result<CliError, string> =>
        parsed.kind === "help"
          ? ok(parsed.usage)
          : pipe(
              collect(
                fs
                  .listShellFiles(
                    parsed.positionals.length === 0
                      ? DEFAULT_ROOTS
                      : parsed.positionals,
                  )
                  .map(checkOne(fs, io.readFile)),
              ),
              andThen(report),
            ),
      ),
    );

export const main: Main = makeMain(nodeShellFs);

if (import.meta.main) run(main);
