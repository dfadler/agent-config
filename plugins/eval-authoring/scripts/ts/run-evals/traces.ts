/**
 * One Markdown file per run with its final reply and tool calls, read from the
 * `trace.jsonl` in the run's sandbox. Only `--keep-temp` leaves that sandbox
 * behind (without it the CLI deletes it before the wrapper can read the trace;
 * #713 1f), so the wrapper writes these only then. Pure: the caller reads and
 * writes; the wrapper never deletes anything.
 */
import { join } from "node:path";
import {
  finalReply,
  isRec,
  list,
  maskHome,
  parse,
  quoteSafe,
  redact,
  toolCalls,
  traceOf,
  truncatedTrace,
} from "./summary.ts";

export interface ReplyFile {
  readonly path: string;
  readonly text: string;
}

const INPUT_MAX = 400;

/** A directory-name-safe form of a case name. */
export const safeName = (name: string): string => name.replace(/[^\w.-]/g, "_");

const render = (
  caseName: string,
  arm: string,
  n: number,
  run: Readonly<Record<string, unknown>>,
  trace: string,
  home: string,
): string => {
  const calls = toolCalls(trace);
  const reply = finalReply(trace);
  const failed = list(run["graders"]).flatMap((g) =>
    isRec(g) && g["passed"] === false ? [typeof g["name"] === "string" ? g["name"] : "(unnamed)"] : [],
  );
  const score = typeof run["score"] === "number" ? run["score"].toFixed(2) : "-";
  return [
    `# ${caseName}: ${arm} arm, run ${String(n)}`,
    "",
    `score ${score}; failed graders: ${failed.length === 0 ? "none" : failed.join(", ")}`,
    ...(typeof run["error"] === "string" ? [`error: ${quoteSafe(run["error"])}`] : []),
    "",
    "## Tool calls",
    "",
    ...(calls.length === 0
      ? ["(none)"]
      : calls.map((c, i) => `${String(i + 1)}. ${c.name} ${quoteSafe(maskHome(c.input, home), INPUT_MAX)}`)),
    "",
    truncatedTrace(trace) ? "## Last complete assistant message" : "## Final reply",
    "",
    reply === undefined ? "(no final assistant message)" : redact(maskHome(reply, home)),
    "",
  ].join("\n");
};

interface Run {
  readonly caseName: string;
  readonly arm: "with" | "without";
  readonly n: number;
  readonly run: Readonly<Record<string, unknown>>;
}

/** Every run of every case in `resultText`, in result order. */
const runsOf = (resultText: string | undefined): readonly Run[] =>
  list(parse(resultText)?.["cases"]).flatMap((c) => {
    if (!isRec(c)) return [];
    const caseName = typeof c["name"] === "string" ? c["name"] : "(unnamed)";
    const arms = isRec(c["arms"]) ? c["arms"] : {};
    return (["with", "without"] as const).flatMap((arm) =>
      list(arms[arm]).flatMap((run, i) => (isRec(run) ? [{ caseName, arm, n: i + 1, run }] : [])),
    );
  });

/** How many runs (both arms, every case) `resultText` holds. */
export const runCount = (resultText: string | undefined): number => runsOf(resultText).length;

/**
 * `<dir>/<case>/<arm>-<run>.md` for every run in `resultText` whose trace
 * `readFile` can read (a relative `tracePath` is skipped: it would resolve
 * against the cwd); a run whose sandbox is gone is skipped, never an error.
 * Each file is redacted like the printed summary, with `home` shown as `~`
 * (the reply in full, each tool input on one line).
 */
export const replyFiles = (
  dir: string,
  resultText: string | undefined,
  readFile: (path: string) => string | undefined,
  home: string,
): readonly ReplyFile[] =>
  runsOf(resultText).flatMap(({ caseName, arm, n, run }) => {
    const trace = traceOf(run, readFile);
    return trace === undefined
      ? []
      : [{ path: join(dir, safeName(caseName), `${arm}-${String(n)}.md`), text: render(caseName, arm, n, run, trace, home) }];
  });
