import { graderLabel } from "../helpers.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

/**
 * One pass over a regex source, yielding the literal characters outside
 * escapes and character classes. Escapes are reported as two characters
 * (`\\` then the next one) so callers can tell `\\"` from `\"`.
 */
interface Tok {
  readonly text: string;
  readonly escaped: boolean;
  readonly index: number;
}
const tokenize = (pattern: string): readonly Tok[] => {
  const out: Tok[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern.charAt(i);
    if (ch === "\\") {
      out.push({ text: pattern.slice(i, i + 2), escaped: true, index: i });
      i += 2;
    } else {
      out.push({ text: ch, escaped: false, index: i });
      i += 1;
    }
  }
  return out;
};

/** `(?i)`, `(?s)`, `(?im)`: inline flag groups, which JavaScript regexes do not support. */
const inlineFlagGroup = (pattern: string): string | undefined => {
  const toks = tokenize(pattern);
  for (let k = 0; k < toks.length; k += 1) {
    const [a, b] = [toks[k], toks[k + 1]];
    if (a?.text !== "(" || a.escaped || b?.text !== "?" || b.escaped) continue;
    let j = k + 2;
    let letters = "";
    while (j < toks.length) {
      const t = toks[j];
      if (t === undefined || t.escaped || !/^[a-zA-Z]$/.test(t.text)) break;
      letters += t.text;
      j += 1;
    }
    const close = toks[j];
    if (letters.length > 0 && close?.text === ")" && !close.escaped) {
      return `(?${letters})`;
    }
  }
  return undefined;
};

/**
 * Looks like it matches file contents, not a path: literal whitespace, a
 * quote, `=` or `;`, or a whitespace escape, and nothing path-shaped.
 */
const looksLikeContent = (pattern: string): boolean => {
  const pathShaped = /\/|\\\.[a-z0-9]+|\.[a-z0-9]{1,5}\$?$/i.test(pattern);
  return !pathShaped && /[ \t"'=;]|\\[sntr]/.test(pattern);
};

/**
 * A `"` that is not a JSON structure quote. In the trace, quotes inside a
 * string value appear as backslash-quote, so a regex for them needs `\\"`. A
 * quote next to `: , { } [ ]` or at either end of the pattern is read as the
 * JSON structure itself (`"command":"npx`) and is fine.
 */
const unescapedValueQuote = (pattern: string): boolean => {
  const toks = tokenize(pattern);
  return toks.some((t, k) => {
    const isQuote = t.text === '"' || t.text === '\\"';
    if (!isQuote) return false;
    const prev = toks[k - 1];
    // `\\"` is a regex escaped backslash then a quote: the right way.
    if (t.text === '"' && prev?.text === "\\\\") return false;
    const next = toks[k + 1];
    const structural = (x: Tok | undefined): boolean =>
      x === undefined || (!x.escaped && ":,{}[]".includes(x.text));
    return !(structural(prev) || structural(next));
  });
};

/** EVAL012: regex graders that cannot work as written, or probably do not. */
export const rule: Rule = {
  id: "EVAL012",
  severity: "error",
  title: "regex graders avoid inline flags, files-as-content and unescaped trace quotes",
  source: fromDocs(
    "troubleshooting: regexes are JavaScript (use flags: i, not (?i)); files targets are paths only; trace is JSON per line so quotes appear as \\\"",
  ),
  checkCase: (c) =>
    c.graders.flatMap((g): Problem[] => {
      if (g.type !== "regex") return [];
      const pattern = g.pattern.value;
      const out: Problem[] = [];
      const inline = inlineFlagGroup(pattern);
      if (inline !== undefined) {
        out.push({
          message: `${graderLabel(g)} uses the inline flag ${inline} in pattern '${pattern}'; the regex is JavaScript, which does not support it.`,
          fix: "Remove the inline group and set the flag with the grader's `flags` key, for example `flags: i`.",
          loc: g.pattern.loc,
        });
      }
      const target = g.target.value;
      if (target.kind === "files" && looksLikeContent(pattern)) {
        out.push({
          message: `${graderLabel(g)} targets files with pattern '${pattern}', which looks like file contents rather than a path (heuristic). The files target is paths only.`,
          fix: "To grade what a file contains, use `target: { source: file, path: <path> }`. Keep `target: files` for matching file paths. Ignore this warning if the pattern really is a path.",
          loc: g.target.loc,
          severity: "warn",
        });
      }
      if (target.kind === "trace" && unescapedValueQuote(pattern)) {
        out.push({
          message: `${graderLabel(g)} matches the trace with pattern '${pattern}', which has a quote that will not match (heuristic). The trace is JSON per line, so a quote inside a value appears as \\".`,
          fix: 'Match the escaped form: write `\\\\"` in the pattern wherever a quote appears inside a value. Ignore this warning if the quote is part of the JSON structure.',
          loc: g.pattern.loc,
          severity: "warn",
        });
      }
      return out;
    }),
};
