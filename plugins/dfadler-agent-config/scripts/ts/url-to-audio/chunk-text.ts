// Split article text into chunks under a character limit, for TTS backends
// (OpenAI's audio/speech endpoint) that cap input length per request: 4096
// chars for tts-1/tts-1-hd, 2000 tokens for gpt-4o-mini-tts (see
// https://platform.openai.com/docs/api-reference/audio/createSpeech). Not
// needed for the default `say` backend, which handles a whole article in one
// call.
//
// Greedy bin-packing, paragraph first, then sentence, then a hard split as a
// last resort for a single run of text longer than the limit on its own. A
// chunk boundary just becomes a small gap in the concatenated audio.
//
// Usage: node chunk-text.ts <input.txt> <output_dir> [--max-chars N]
//
// Writes chunk_0001.txt, chunk_0002.txt, ... to output_dir and prints one path
// per line, in order. Plugin-owned and standalone: node builtins only, no
// import from scripts/ts/lib (a plugin installs on its own).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

export const DEFAULT_MAX_CHARS = 4096;

const USAGE = `Usage: chunk-text.ts <input.txt> <output_dir> [--max-chars N]
`;

const PARAGRAPH_SPLIT = /\n\s*\n/;
const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

/** Greedily pack units (each <= maxChars) into chunks joined by `sep`. */
const pack = (units: string[], maxChars: number, sep: string): string[] => {
  const chunks: string[] = [];
  let buf = "";
  for (const unit of units) {
    if (buf === "") buf = unit;
    else if (buf.length + sep.length + unit.length <= maxChars) buf += sep + unit;
    else {
      chunks.push(buf);
      buf = unit;
    }
  }
  if (buf !== "") chunks.push(buf);
  return chunks;
};

/** Fixed-size slices by code point, so a surrogate pair is never cut in half. */
const hardSplit = (text: string, maxChars: number): string[] => {
  const points = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < points.length; i += maxChars) {
    out.push(points.slice(i, i + maxChars).join(""));
  }
  return out;
};

/** A unit longer than maxChars alone: sentence split, then hard split. */
const splitOversized = (unit: string, maxChars: number): string[] => {
  const sentences = unit.split(SENTENCE_SPLIT).filter((s) => s.trim() !== "");
  if (sentences.length > 1) {
    return pack(
      sentences.flatMap((s) => (s.length <= maxChars ? [s] : hardSplit(s, maxChars))),
      maxChars,
      " ",
    );
  }
  return hardSplit(unit, maxChars);
};

export const chunkText = (text: string, maxChars = DEFAULT_MAX_CHARS): string[] => {
  if (!(maxChars > 0)) throw new RangeError("maxChars must be positive");
  const units = text
    .split(PARAGRAPH_SPLIT)
    .filter((p) => p.trim() !== "")
    .flatMap((p) => (p.length <= maxChars ? [p] : splitOversized(p, maxChars)));
  return pack(units, maxChars, "\n\n");
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** CLI body; returns the exit code. Output goes through `out`/`errOut`. */
export const main = (
  argv: string[],
  out: (s: string) => void = (s) => process.stdout.write(s),
  errOut: (s: string) => void = (s) => process.stderr.write(s),
): number => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        "max-chars": { type: "string", default: String(DEFAULT_MAX_CHARS) },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    errOut(`${message(e)}\n${USAGE}`);
    return 2;
  }
  if (parsed.values.help === true) {
    out(USAGE);
    return 0;
  }
  const [input, outputDir] = parsed.positionals;
  const maxChars = Number(parsed.values["max-chars"]);
  if (input === undefined || outputDir === undefined || parsed.positionals.length !== 2) {
    errOut(`input and output_dir are required\n${USAGE}`);
    return 2;
  }
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    errOut(`--max-chars must be a positive integer\n${USAGE}`);
    return 2;
  }
  let chunks: string[];
  try {
    chunks = chunkText(readFileSync(input, "utf8"), maxChars);
  } catch (e) {
    errOut(`error: cannot read ${input}: ${message(e)}\n`);
    return 1;
  }
  if (chunks.length === 0) {
    errOut("error: no text to chunk (empty input)\n");
    return 1;
  }
  mkdirSync(outputDir, { recursive: true });
  chunks.forEach((chunk, i) => {
    const path = join(outputDir, `chunk_${String(i + 1).padStart(4, "0")}.txt`);
    writeFileSync(path, chunk, "utf8");
    out(`${path}\n`);
  });
  return 0;
};

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
