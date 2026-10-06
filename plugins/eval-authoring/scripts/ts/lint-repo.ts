/**
 * Run the eval-authoring lint over every plugin in a repo that has an `evals/`
 * directory (#488): the CI/`make check` entrypoint, so an error finding such as
 * EVAL004 fails the build. `node lint-repo.ts [ROOT]`. `main` takes the lint
 * as a parameter so tests can run it without the real rules.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { mainWithDiscoveredRules, type CliResult } from "./lint/cli.ts";

export const USAGE = `Usage: lint-repo.ts [-h|--help] [ROOT]

Lint the eval cases of every plugin under ROOT/plugins that has an evals/
directory (default ROOT: .). Prints each plugin's lint summary line, and the
full report for a plugin that has errors. Exits 1 if any plugin has an error.

  -h, --help   Show this message and exit.
`;

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;

export type Lint = (argv: readonly string[]) => Promise<CliResult>;

const pluginsWithEvals = (root: string): readonly string[] =>
  readdirSync(join(root, "plugins"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(root, "plugins", e.name, "evals")))
    .map((e) => join(root, "plugins", e.name))
    .sort();

const lastLine = (text: string): string =>
  text.trimEnd().split("\n").at(-1) ?? "";

/** Returns the process exit code. */
export async function main(
  argv: readonly string[],
  out: (s: string) => void,
  err: (s: string) => void,
  lint: Lint = mainWithDiscoveredRules,
): Promise<number> {
  const [first] = argv;
  if (first === "-h" || first === "--help") {
    out(USAGE);
    return EXIT_OK;
  }
  const root = first ?? ".";
  if (!existsSync(join(root, "plugins"))) {
    err(`no plugins/ directory under ROOT: ${root}`);
    return EXIT_USAGE;
  }
  let failed = false;
  for (const plugin of pluginsWithEvals(root)) {
    const result = await lint([plugin]);
    if (result.code === EXIT_OK) {
      out(`${lastLine(result.stdout)}\n`);
    } else {
      failed = true;
      out(result.stdout);
      err(`${plugin}: lint exited ${String(result.code)}${result.stderr === "" ? "" : `: ${result.stderr.trim()}`}`);
    }
  }
  return failed ? EXIT_FAILURE : EXIT_OK;
}

if (import.meta.main) {
  process.exitCode = await main(
    process.argv.slice(2),
    (s) => process.stdout.write(s),
    (s) => process.stderr.write(`${s}\n`),
  );
}
