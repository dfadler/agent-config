/**
 * One Markdown file per run with its final reply and tool calls, read from the
 * `trace.jsonl` the CLI kept. The wrapper always passes `--keep-temp`: without
 * it the CLI deletes each run's sandbox and every `tracePath` in the result
 * dangles, so a low score could only be read from pass counts (#713 1f). Pure:
 * the caller writes the files.
 */
import { join } from "node:path";
import {
  finalReply,
  isRec,
  list,
  parse,
  quoteSafe,
  redact,
  toolCalls,
} from "./summary.ts";

export interface ReplyFile {
  readonly path: string;
  readonly text: string;
}

const INPUT_MAX = 400;

const render = (
  caseName: string,
  arm: string,
  n: number,
  run: Readonly<Record<string, unknown>>,
  trace: string,
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
      : calls.map((c, i) => `${String(i + 1)}. ${c.name} ${quoteSafe(c.input, INPUT_MAX)}`)),
    "",
    "## Final reply",
    "",
    reply === undefined ? "(no final assistant message)" : redact(reply),
    "",
  ].join("\n");
};

/**
 * `<dir>/<arm>-<run>.md` for every run in `resultText` whose trace `readFile`
 * can read; a run whose sandbox is gone is skipped, never an error. Each file
 * is redacted like the printed summary (the reply in full, each tool input on
 * one line).
 */
export const replyFiles = (
  dir: string,
  resultText: string | undefined,
  readFile: (path: string) => string | undefined,
): readonly ReplyFile[] =>
  list(parse(resultText)?.["cases"]).flatMap((c) => {
    if (!isRec(c)) return [];
    const caseName = typeof c["name"] === "string" ? c["name"] : "(unnamed)";
    const arms = isRec(c["arms"]) ? c["arms"] : {};
    return (["with", "without"] as const).flatMap((arm) =>
      list(arms[arm]).flatMap((run, i) => {
        const tracePath = isRec(run) ? run["tracePath"] : undefined;
        const trace = typeof tracePath === "string" ? readFile(tracePath) : undefined;
        return !isRec(run) || trace === undefined
          ? []
          : [{ path: join(dir, `${arm}-${String(i + 1)}.md`), text: render(caseName, arm, i + 1, run, trace) }];
      }),
    );
  });
