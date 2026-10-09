// Flag-drift guard (#479): every --flag documented for Vitest in this repo must
// appear in `vitest --help --expand-help` for the pinned version. Catches a
// flag that a Vitest upgrade removed or renamed before a doc keeps teaching it.
// The logic lives in vitest-guards.ts.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { parseArgs, type Parsed } from "./lib/args.ts";
import {
  cliError,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  type CliError,
} from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, collect, err, map, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";
import {
  extractFlags,
  formatMissingFlags,
  missingFlags,
} from "./vitest-guards.ts";

const USAGE = `Usage: check-vitest-flags.ts [-h|--help] [FILE...]

Fail if a --flag documented for Vitest is absent from \`vitest --help
--expand-help\` on the pinned version. Default FILEs: the SKILL.md of every
plugins/vitest skill, .claude/rules/vitest.md and docs/testing.md.

  -h, --help   Show this message and exit.
`;

const SUCCESS = "✓ Every documented Vitest flag appears in `vitest --help`.\n";

const SKILLS_DIR = "plugins/vitest/skills";

/** The effects the check needs beyond reading files. */
export interface FlagEnv {
  /** Output of `vitest --help --expand-help`, or an error when it cannot run. */
  readonly helpText: () => Result<CliError, string>;
  /** The default documents to scan. */
  readonly defaultFiles: () => readonly string[];
}

export const nodeFlagEnv: FlagEnv = {
  helpText: () => {
    const r = spawnSync("pnpm", ["exec", "vitest", "--help", "--expand-help"], {
      encoding: "utf8",
    });
    return r.status === 0
      ? ok(r.stdout)
      : err(
          cliError(
            EXIT_DEPENDENCY,
            `could not run \`pnpm exec vitest --help\` (run \`pnpm install\` first): ${r.stderr}`,
          ),
        );
  },
  defaultFiles: () => [
    ...readdirSync(SKILLS_DIR)
      .sort()
      .map((skill) => `${SKILLS_DIR}/${skill}/SKILL.md`),
    ".claude/rules/vitest.md",
    "docs/testing.md",
  ],
};

export const makeMain =
  (env: FlagEnv): Main =>
  (argv, _env, io) =>
    pipe(
      parseArgs({ usage: USAGE }, argv),
      andThen((parsed: Parsed): Result<CliError, string> => {
        if (parsed.kind === "help") return ok(parsed.usage);
        const files =
          parsed.positionals.length === 0
            ? env.defaultFiles()
            : parsed.positionals;
        return pipe(
          env.helpText(),
          andThen((help: string) =>
            pipe(
              collect(
                files.map((f) =>
                  pipe(
                    io.readFile(f),
                    map((text) => ({ file: f, text })),
                  ),
                ),
              ),
              andThen((docs): Result<CliError, string> => {
                const missing = docs.flatMap(({ file, text }) =>
                  missingFlags(extractFlags(text), help).map((flag) => ({
                    file,
                    flag,
                  })),
                );
                const report = formatMissingFlags(missing);
                return report === undefined
                  ? ok(SUCCESS)
                  : err(cliError(EXIT_FAILURE, report));
              }),
            ),
          ),
        );
      }),
    );

export const main: Main = makeMain(nodeFlagEnv);

if (import.meta.main) run(main);
