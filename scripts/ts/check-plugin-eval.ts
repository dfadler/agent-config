// Plugin-eval result checker (#583), called by the plugin-evals workflow after
// `claude plugin eval`. Decision record: docs/plugin-eval-ci.md (#436).
//
//   check-plugin-eval.ts --cli-exit N --threshold T aggregate-result.json
//
// Exit codes: 0 pass, 1 regression (valid run, CLI exit non-zero against the
// threshold), 7 inconclusive (invalid run, so not a regression), 2 usage.
import { parseArgs, type Parsed } from "./lib/args.ts";
import {
  cliError,
  EXIT_FAILURE,
  EXIT_PARTIAL,
  EXIT_USAGE,
  type CliError,
} from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, err, fromThrowable, ok, type Result } from "./lib/result.ts";
import { run, type Main } from "./lib/run.ts";
import { describeThrown } from "./lib/thrown.ts";

const USAGE = `Usage: check-plugin-eval.ts [-h|--help] --cli-exit N --threshold T RESULT.json

Decide pass / regression / inconclusive for a \`claude plugin eval\` run.

  --cli-exit N     Exit code the eval CLI returned (run with --threshold T).
  --threshold T    The threshold the CLI was given; reported in messages.
  RESULT.json      The run's aggregate-result.json.

Inconclusive (exit 7, not a regression): CLI exit 2, \`partial: true\`, any
\`skippedPaidGraders\`, any \`arms.with[].error\`, or an unreadable result.
Regression (exit 1): a valid run where the CLI exited non-zero.
Delta is warn-only; a missing delta means no signal. Exit 2: bad arguments.

  -h, --help       Show this message and exit.
`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : []);

/** Reasons the run cannot be trusted; empty when it is valid. */
const invalidReasons = (doc: Record<string, unknown>): readonly string[] => [
  ...(doc["partial"] === true ? ["partial: true"] : []),
  ...list(doc["cases"]).flatMap((c) => {
    if (!isRecord(c)) return [];
    const name = String(c["name"]);
    const arms = isRecord(c["arms"]) ? c["arms"] : {};
    return list(arms["with"]).flatMap((a) =>
      !isRecord(a)
        ? []
        : [
            ...(a["error"] != null
              ? [`${name}: arm error: ${JSON.stringify(a["error"])}`]
              : []),
            ...(a["skippedPaidGraders"] === true
              ? [`${name}: skippedPaidGraders`]
              : []),
          ],
    );
  }),
];

/** Warn-only delta signals; a missing delta is no signal, not a warning. */
const deltaWarnings = (doc: Record<string, unknown>): readonly string[] =>
  list(doc["cases"]).flatMap((c) => {
    if (!isRecord(c) || !isRecord(c["aggregates"])) return [];
    const d = c["aggregates"]["delta"];
    return typeof d === "number" && d <= 0
      ? [`warning: ${String(c["name"])}: delta ${String(d)} <= 0\n`]
      : [];
  });

const inconclusive = (why: string): Result<CliError, never> =>
  err(cliError(EXIT_PARTIAL, `inconclusive: ${why}`));

const parseCliExit = (v: unknown): Result<CliError, number> => {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0
    ? ok(n)
    : err(
        cliError(
          EXIT_USAGE,
          `--cli-exit needs a non-negative integer\n\n${USAGE}`,
        ),
      );
};

const decide = (
  cliExit: number,
  threshold: string,
  doc: unknown,
): Result<CliError, string> => {
  if (cliExit === 2) return inconclusive("eval CLI exited 2 (invalid run)");
  if (!isRecord(doc)) return inconclusive("result is not a JSON object");
  const bad = invalidReasons(doc);
  if (bad.length > 0) return inconclusive(bad.join("; "));
  const warns = deltaWarnings(doc).join("");
  return cliExit === 0
    ? ok(`${warns}pass: threshold ${threshold} met\n`)
    : err(
        cliError(
          EXIT_FAILURE,
          `${warns}regression: CLI exit ${String(cliExit)} against threshold ${threshold}`,
        ),
      );
};

export const main: Main = (argv, _env, io) =>
  pipe(
    parseArgs(
      {
        usage: USAGE,
        flags: [
          { name: "cli-exit", valued: true },
          { name: "threshold", valued: true },
        ],
        minPositionals: 1,
        maxPositionals: 1,
      },
      argv,
    ),
    andThen((p: Parsed): Result<CliError, string> => {
      if (p.kind === "help") return ok(p.usage);
      const threshold = p.flags["threshold"];
      const path = p.positionals[0];
      if (typeof threshold !== "string" || path === undefined) {
        return err(cliError(EXIT_USAGE, `--threshold is required\n\n${USAGE}`));
      }
      return pipe(
        parseCliExit(p.flags["cli-exit"]),
        andThen((cliExit) => {
          // An unreadable or unparseable result means the run is untrustworthy.
          const doc = pipe(
            io.readFile(path),
            andThen((text) =>
              fromThrowable(
                (): unknown => JSON.parse(text),
                (t) => cliError(EXIT_PARTIAL, describeThrown(t)),
              ),
            ),
          );
          return doc.tag === "err"
            ? inconclusive(`${path}: ${doc.error.message}`)
            : decide(cliExit, threshold, doc.value);
        }),
      );
    }),
  );

if (import.meta.main) run(main);
