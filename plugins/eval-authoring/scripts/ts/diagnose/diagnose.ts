// Per-case verdict on whether each eval case is useful, from an
// aggregate-result.json. Reads the result file only; makes no model calls.
import { readFileSync } from "node:fs";
import { readAggregateResult } from "../parser/index.ts";
import { formatJson, formatText } from "./format.ts";
import { DEFAULT_THRESHOLDS, diagnose, type Thresholds } from "./verdict.ts";

/** Shared exit-code taxonomy (docs/testing.md); only the codes this script uses. */
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export const USAGE = `Usage: diagnose.ts [-h|--help] [--format text|json] [--<threshold> N]... RESULT.json

Print a per-case verdict from an aggregate-result.json: whether each case
discriminates the plugin from no plugin (delta above zero on scored graders),
plus mechanical findings (negative delta, split judge votes, run errors,
skipped judges, partial results, run-to-run variance). No model calls.
The verdicts do not change the exit code.

  --format text|json   Output format (default: text).
  --neutral-band N, --se-floor N, --near-ceiling N, --high-variance N
                       Override a verdict cutoff for this run (defaults 0.05,
                       0.05, 0.95, 0.25; see the diagnose-scores skill).
                       Ranges: --neutral-band and --near-ceiling (0, 1];
                       --se-floor and --high-variance [0, 1].
  -h, --help           Show this message and exit.

Exit codes: 0 verdicts printed, 1 unreadable or unsupported result,
2 bad arguments or missing file.
`;

export interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Io {
  /** The file's text, or undefined when it cannot be read. */
  readonly readFile: (path: string) => string | undefined;
}

/** Every threshold is at most 1; `zeroOk` says whether 0 is allowed too. */
const THRESHOLD_FLAGS: Readonly<
  Record<string, { readonly key: keyof Thresholds; readonly zeroOk: boolean }>
> = {
  "--neutral-band": { key: "neutralBand", zeroOk: false },
  "--se-floor": { key: "seFloor", zeroOk: true },
  "--near-ceiling": { key: "nearCeiling", zeroOk: false },
  "--high-variance": { key: "highVariance", zeroOk: true },
};

/** A plain decimal ("0", "0.1", ".5") in [0, 1], or (0, 1] unless `zeroOk`; else undefined. */
const parseThreshold = (text: string, zeroOk: boolean): number | undefined => {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const n = Number(text);
  return n > 1 || (n === 0 && !zeroOk) ? undefined : n;
};

const usageError = (message: string): Outcome => ({
  code: EXIT_USAGE,
  stdout: "",
  stderr: `${message}\n${USAGE}`,
});

/** Pure given `io`: argv in, exit code and output out. */
export const main = (argv: readonly string[], io: Io): Outcome => {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { code: EXIT_OK, stdout: USAGE, stderr: "" };
  }
  const formatAt = argv.indexOf("--format");
  const format = formatAt === -1 ? "text" : argv[formatAt + 1];
  if (format !== "text" && format !== "json") {
    return usageError("--format needs text or json");
  }
  const overrides: Partial<Record<keyof Thresholds, number>> = {};
  const skip = new Set(formatAt === -1 ? [] : [formatAt, formatAt + 1]);
  for (const [flag, { key, zeroOk }] of Object.entries(THRESHOLD_FLAGS)) {
    const at = argv.indexOf(flag);
    if (at === -1) continue;
    const n = parseThreshold(argv[at + 1] ?? "", zeroOk);
    if (n === undefined) {
      return usageError(`${flag} needs a number in ${zeroOk ? "[" : "("}0, 1]`);
    }
    overrides[key] = n;
    skip.add(at).add(at + 1);
  }
  const rest = argv.filter((_, i) => !skip.has(i));
  const stray = rest.find((a) => a.startsWith("-"));
  if (stray !== undefined) return usageError(`unknown or repeated option ${stray}`);
  const [path, ...extra] = rest;
  if (path === undefined || extra.length > 0) {
    return usageError("expected exactly one RESULT.json path");
  }
  const text = io.readFile(path);
  if (text === undefined) return usageError(`cannot read ${path}`);
  const parsed = readAggregateResult(text);
  if (!parsed.ok) {
    return {
      code: EXIT_FAILURE,
      stdout: "",
      stderr: `${path}: ${parsed.reason}\n`,
    };
  }
  const diagnosis = diagnose(parsed.result, { ...DEFAULT_THRESHOLDS, ...overrides });
  return {
    code: EXIT_OK,
    stdout: format === "json" ? formatJson(diagnosis) : formatText(diagnosis),
    stderr: "",
  };
};

const readFileOrUndefined = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
};

if (import.meta.main) {
  const out = main(process.argv.slice(2), { readFile: readFileOrUndefined });
  process.stdout.write(out.stdout);
  process.stderr.write(out.stderr);
  process.exitCode = out.code;
}
