// Enforce a ceiling on claude/CLAUDE.md's line count.
//
// claude/CLAUDE.md is the *global* ~/.claude/CLAUDE.md (see setup.sh), loaded
// into every session on this machine regardless of project, so it must stay
// small. The ceiling is a MEASURED baseline plus headroom and lives in the
// Makefile (CLAUDE_MD_MAX_LINES), so changing it takes a deliberate commit.
import {
  cliError,
  EXIT_FAILURE,
  EXIT_USAGE,
  type CliError,
} from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, err, mapErr, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";

const NAME = "check-claude-md-lines.ts";

export const USAGE = `Usage: ${NAME} [-h|--help] <file> <max-lines>

Fail if <file> has more than <max-lines> lines.

  -h, --help   Show this message and exit.
`;

/** Newline count, as `wc -l` reports it: a final unterminated line is not counted. */
export const countLines = (text: string): number => text.split("\n").length - 1;

/** `max-lines` must be a plain run of digits: no sign, no variable left unexpanded. */
export const parseMaxLines = (raw: string): number | undefined =>
  /^[0-9]+$/.test(raw) ? Number(raw) : undefined;

/** Pure verdict: `ok` is the pass line, `err` the over-ceiling failure. */
export const checkLines = (
  file: string,
  lines: number,
  max: number,
  maxRaw: string,
): Result<CliError, string> =>
  lines > max
    ? err(
        cliError(
          EXIT_FAILURE,
          `::error::${file} is ${String(lines)} lines, over the ${maxRaw}-line ceiling — trim it or move content that isn't universally relevant into a skill/doc instead (see #137).`,
        ),
      )
    : ok(`✓ ${file} is ${String(lines)} lines (ceiling: ${maxRaw})\n`);

const usageError = (message: string): Result<CliError, never> =>
  err(cliError(EXIT_USAGE, `${message}\n${USAGE}`));

// Hand-rolled rather than parseArgs: a negative max-lines such as `-5` must
// reach the "not a non-negative integer" check, not be read as an option.
export const main: Main = (argv, _env, io) => {
  const [file, maxRaw] = argv;
  if (file === "-h" || file === "--help") return ok(USAGE);
  if (file === undefined || maxRaw === undefined) {
    return usageError(`::error::usage: ${NAME} <file> <max-lines>`);
  }
  return pipe(
    io.readFile(file),
    mapErr(() => cliError(EXIT_USAGE, `::error::file not found: ${file}`)),
    andThen((text: string) => {
      const max = parseMaxLines(maxRaw);
      return max === undefined
        ? usageError(
            `::error::max-lines value is not a non-negative integer: '${maxRaw}'`,
          )
        : checkLines(file, countLines(text), max, maxRaw);
    }),
  );
};

if (import.meta.main) run(main);
