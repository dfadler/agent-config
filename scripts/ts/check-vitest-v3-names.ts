// v3-name guard (#479): Vitest 3 option and env names (poolOptions, maxThreads,
// VITEST_MAX_THREADS, ...) were removed or renamed in Vitest 4+, yet third-party
// and AI-generated answers still use them. Fail when plugins/, docs/ or .claude/
// mention one on a line that does not also say "removed", "not in" or "renamed".
// The logic lives in vitest-guards.ts.
import { lstatSync, readdirSync } from "node:fs";
import { parseArgs, type Parsed } from "./lib/args.ts";
import { cliError, EXIT_FAILURE, type CliError } from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, collect, err, map, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";
import { findV3Names, formatV3Hits } from "./vitest-guards.ts";

const USAGE = `Usage: check-vitest-v3-names.ts [-h|--help] [DIR...]

Fail if a text file under DIR (default: plugins docs .claude) names a Vitest 3
option (poolOptions, maxThreads, maxForks, singleThread, singleFork,
VITEST_MAX_THREADS, VITEST_MAX_FORKS) on a line that does not also say
"removed", "not in" or "renamed".

  -h, --help   Show this message and exit.
`;

const DEFAULT_ROOTS: readonly string[] = ["plugins", "docs", ".claude"];
const SKIP_DIRS: readonly string[] = ["node_modules", "worktrees", ".git"];
const TEXT_FILE = /\.(?:md|ts|js|json|ya?ml|sh|txt)$/;

const SUCCESS = "✓ No unannotated Vitest 3 option names.\n";

/** Text files under (or equal to) each root; missing roots are skipped. */
export type ListFiles = (roots: readonly string[]) => readonly string[];

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
  if (kind === "file") return TEXT_FILE.test(path) ? [path] : [];
  if (kind !== "dir") return [];
  return readdirSync(path)
    .sort()
    .filter((entry) => !SKIP_DIRS.includes(entry))
    .flatMap((entry) => walk(`${path}/${entry}`));
};

export const nodeListFiles: ListFiles = (roots) => roots.flatMap(walk);

export const makeMain =
  (listFiles: ListFiles): Main =>
  (argv, _env, io) =>
    pipe(
      parseArgs({ usage: USAGE }, argv),
      andThen((parsed: Parsed): Result<CliError, string> => {
        if (parsed.kind === "help") return ok(parsed.usage);
        const files = listFiles(
          parsed.positionals.length === 0 ? DEFAULT_ROOTS : parsed.positionals,
        );
        return pipe(
          collect(
            files.map((f) =>
              pipe(
                io.readFile(f),
                map((text) => findV3Names(f, text)),
              ),
            ),
          ),
          andThen((all): Result<CliError, string> => {
            const report = formatV3Hits(all.flat());
            return report === undefined
              ? ok(SUCCESS)
              : err(cliError(EXIT_FAILURE, report));
          }),
        );
      }),
    );

export const main: Main = makeMain(nodeListFiles);

if (import.meta.main) run(main);
