/**
 * A small, dependency-free YAML reader for eval cases and the grants file, with
 * a line and column on every node (lint messages point at them).
 *
 * A plugin is installed on its own, so its scripts cannot rely on a repo-level
 * `node_modules`; this reads the YAML subset that case files use instead of
 * importing a library. Supported: block maps and sequences (a sequence may sit
 * at its parent key's indent), `- key: value` items, flow `[a, b]` and
 * `{k: v}` on one line, plain, single-quoted and double-quoted scalars, block
 * scalars (`|` and `>` with `-`/`+` chomping), comments, and a leading `---`.
 * Not supported, and reported as an error rather than misread: anchors,
 * aliases, tags, explicit indentation indicators, multi-line plain or quoted
 * scalars, multi-line flow collections, tabs in indentation, duplicate keys.
 */

/** A scalar. `text` is the value as written (unquoted); `value` is its YAML-typed reading. */
export interface YScalar {
  readonly kind: "scalar";
  readonly value: string | number | boolean | null;
  readonly text: string;
  readonly quoted: boolean;
  readonly line: number;
  readonly column: number;
}

/** One `key: value` pair of a mapping. */
export interface YEntry {
  readonly key: string;
  readonly keyLine: number;
  readonly keyColumn: number;
  readonly value: YNode;
}

/** A mapping, entries in file order. */
export interface YMap {
  readonly kind: "map";
  readonly entries: readonly YEntry[];
  readonly line: number;
  readonly column: number;
}

/** A sequence. */
export interface YSeq {
  readonly kind: "seq";
  readonly items: readonly YNode[];
  readonly line: number;
  readonly column: number;
}

/** Any YAML node. */
export type YNode = YScalar | YMap | YSeq;

/** Outcome of reading YAML text. An error is reported, not thrown. */
export type YamlResult =
  | { readonly ok: true; readonly value: YNode | undefined }
  | {
      readonly ok: false;
      readonly message: string;
      readonly line: number;
      readonly column: number;
    };

/** The split of a Markdown file into frontmatter and body. */
export type Frontmatter =
  | {
      readonly kind: "none";
      readonly body: string;
      readonly bodyLine: number;
    }
  | { readonly kind: "unterminated" }
  | {
      readonly kind: "found";
      /** The YAML between the fences. */
      readonly yaml: string;
      /** 1-based line of the first YAML line. */
      readonly yamlLine: number;
      readonly body: string;
      /** 1-based line of the first body line. */
      readonly bodyLine: number;
    };

/** Split `---` fenced frontmatter from the body of a Markdown file. */
export const splitFrontmatter = (text: string): Frontmatter => {
  const lines = text.split(/\r?\n/);
  if ((lines[0] ?? "").trimEnd() !== "---") {
    return { kind: "none", body: text, bodyLine: 1 };
  }
  const close = lines.findIndex(
    (l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."),
  );
  if (close === -1) return { kind: "unterminated" };
  return {
    kind: "found",
    yaml: lines.slice(1, close).join("\n"),
    yamlLine: 2,
    body: lines.slice(close + 1).join("\n"),
    bodyLine: close + 2,
  };
};

class YamlError extends Error {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super(message);
    this.line = line;
    this.column = column;
  }
}

interface Line {
  /** 1-based line number in the file. */
  readonly no: number;
  readonly raw: string;
  /** Leading spaces. */
  readonly indent: number;
  /** Text after the indent, comment removed, right-trimmed. */
  readonly content: string;
}

const isSpace = (c: string | undefined): boolean => c === " " || c === "\t";

/** Cut a trailing ` # comment`, ignoring `#` inside quotes. */
const stripComment = (s: string): string => {
  const scan = (
    i: number,
    quote: "'" | '"' | undefined,
    prev: string | undefined,
  ): number => {
    if (i >= s.length) return s.length;
    const c = s.charAt(i);
    if (quote === '"') {
      if (c === "\\") return scan(i + 2, quote, undefined);
      return scan(i + 1, c === '"' ? undefined : quote, c);
    }
    if (quote === "'") {
      return scan(i + 1, c === "'" ? undefined : quote, c);
    }
    if (c === "#" && (prev === undefined || isSpace(prev))) return i;
    const opens =
      (c === '"' || c === "'") &&
      (prev === undefined || isSpace(prev) || "[{,".includes(prev));
    return scan(i + 1, opens ? c : undefined, c);
  };
  return s.slice(0, scan(0, undefined, undefined)).trimEnd();
};

const TRUE_RE = /^(true|True|TRUE)$/;
const FALSE_RE = /^(false|False|FALSE)$/;
const NULL_RE = /^(~|null|Null|NULL)$/;
const INT_RE = /^[-+]?\d+$/;
const FLOAT_RE = /^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/;

const typePlain = (text: string): string | number | boolean | null => {
  if (NULL_RE.test(text)) return null;
  if (TRUE_RE.test(text)) return true;
  if (FALSE_RE.test(text)) return false;
  if (INT_RE.test(text) || FLOAT_RE.test(text)) return Number(text);
  return text;
};

const ESCAPES: Readonly<Record<string, string>> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  '"': '"',
  "\\": "\\",
  "/": "/",
  " ": " ",
};

/** Read a double-quoted scalar from `s` at `start` (the opening quote). Returns the text and end index. */
const readDouble = (
  s: string,
  start: number,
  fail: (m: string, at: number) => never,
): { readonly text: string; readonly end: number } => {
  const go = (i: number, acc: string): { text: string; end: number } => {
    if (i >= s.length) return fail("unterminated double-quoted string", start);
    const c = s.charAt(i);
    if (c === '"') return { text: acc, end: i + 1 };
    if (c !== "\\") return go(i + 1, acc + c);
    const e = s.charAt(i + 1);
    if (e === "x" || e === "u") {
      const len = e === "x" ? 2 : 4;
      const hex = s.slice(i + 2, i + 2 + len);
      if (!new RegExp(`^[0-9a-fA-F]{${String(len)}}$`).test(hex)) {
        return fail("invalid escape in double-quoted string", i);
      }
      return go(
        i + 2 + len,
        acc + String.fromCodePoint(Number.parseInt(hex, 16)),
      );
    }
    const mapped = ESCAPES[e];
    if (mapped === undefined) {
      return fail("invalid escape in double-quoted string", i);
    }
    return go(i + 2, acc + mapped);
  };
  return go(start + 1, "");
};

const readSingle = (
  s: string,
  start: number,
  fail: (m: string, at: number) => never,
): { readonly text: string; readonly end: number } => {
  const go = (i: number, acc: string): { text: string; end: number } => {
    if (i >= s.length) return fail("unterminated single-quoted string", start);
    const c = s.charAt(i);
    if (c !== "'") return go(i + 1, acc + c);
    if (s.charAt(i + 1) === "'") return go(i + 2, acc + "'");
    return { text: acc, end: i + 1 };
  };
  return go(start + 1, "");
};

/** The key at the start of a line's content, when it is a `key: ...` line. */
const splitKey = (
  content: string,
  fail: (m: string, at: number) => never,
):
  | { readonly key: string; readonly rest: string; readonly restAt: number }
  | undefined => {
  const first = content.charAt(0);
  if (first === "[" || first === "{" || first === "") return undefined;
  if (first === '"' || first === "'") {
    const q =
      first === '"'
        ? readDouble(content, 0, fail)
        : readSingle(content, 0, fail);
    const after = content.slice(q.end);
    const trimmed = after.trimStart();
    if (!trimmed.startsWith(":")) return undefined;
    const restAt = q.end + (after.length - trimmed.length) + 1;
    return { key: q.text, rest: content.slice(restAt), restAt };
  }
  const m = /:(\s|$)/.exec(content);
  if (m === null) return undefined;
  return {
    key: content.slice(0, m.index).trimEnd(),
    rest: content.slice(m.index + 1),
    restAt: m.index + 1,
  };
};

/**
 * Parse YAML text. `firstLine` is the 1-based file line of the text's first
 * line, so frontmatter nodes carry real file positions.
 */
export const parseYaml = (text: string, firstLine = 1): YamlResult => {
  const lines: Line[] = text.split(/\r?\n/).map((raw, i) => {
    const indent = raw.length - raw.trimStart().length;
    return {
      no: firstLine + i,
      raw,
      indent,
      content: stripComment(raw.slice(indent)),
    };
  });
  // Next unconsumed line index; `peek` skips blank and comment-only lines.
  let pos = 0;

  const failAt = (message: string, line: number, column: number): never => {
    throw new YamlError(message, line, column);
  };

  const peek = (): Line | undefined => {
    while (pos < lines.length) {
      const l = lines[pos];
      if (l === undefined) return undefined;
      if (l.raw.trim() === "" || l.content === "") {
        pos += 1;
        continue;
      }
      if (/^\s*\t/.test(l.raw)) {
        return failAt("tabs are not allowed in indentation", l.no, 1);
      }
      return l;
    }
    return undefined;
  };

  const isSeqLine = (l: Line): boolean =>
    l.content === "-" || l.content.startsWith("- ");

  const scalar = (
    value: string | number | boolean | null,
    textValue: string,
    quoted: boolean,
    line: number,
    column: number,
  ): YScalar => ({
    kind: "scalar",
    value,
    text: textValue,
    quoted,
    line,
    column,
  });

  /** Parse a flow collection or scalar occupying `s` (already comment-stripped, trimmed). */
  const parseInline = (s: string, line: number, column: number): YNode => {
    const failIn = (m: string, at: number): never =>
      failAt(m, line, column + at);
    const flow = (i: number): { node: YNode; end: number } => {
      const ws = (j: number): number => (isSpace(s[j]) ? ws(j + 1) : j);
      const start = ws(i);
      const c = s.charAt(start);
      const col = column + start;
      if (c === '"') {
        const q = readDouble(s, start, failIn);
        return { node: scalar(q.text, q.text, true, line, col), end: q.end };
      }
      if (c === "'") {
        const q = readSingle(s, start, failIn);
        return { node: scalar(q.text, q.text, true, line, col), end: q.end };
      }
      if (c === "[") {
        const items: YNode[] = [];
        const loop = (j: number): number => {
          const k = ws(j);
          if (s.charAt(k) === "]") return k + 1;
          if (k >= s.length) {
            return failIn("unterminated flow sequence (one line only)", start);
          }
          const item = flow(k);
          items.push(item.node);
          const e = ws(item.end);
          if (s.charAt(e) === ",") return loop(e + 1);
          if (s.charAt(e) === "]") return e + 1;
          return failIn("expected ',' or ']' in flow sequence", e);
        };
        const end = loop(start + 1);
        return { node: { kind: "seq", items, line, column: col }, end };
      }
      if (c === "{") {
        const entries: YEntry[] = [];
        const loop = (j: number): number => {
          const k = ws(j);
          if (s.charAt(k) === "}") return k + 1;
          if (k >= s.length) {
            return failIn("unterminated flow mapping (one line only)", start);
          }
          const keyNode = flow(k);
          const e = ws(keyNode.end);
          if (keyNode.node.kind !== "scalar" || s.charAt(e) !== ":") {
            return failIn("expected 'key: value' in flow mapping", k);
          }
          const val = flow(e + 1);
          entries.push({
            key: keyNode.node.text,
            keyLine: line,
            keyColumn: column + k,
            value: val.node,
          });
          const f = ws(val.end);
          if (s.charAt(f) === ",") return loop(f + 1);
          if (s.charAt(f) === "}") return f + 1;
          return failIn("expected ',' or '}' in flow mapping", f);
        };
        const end = loop(start + 1);
        return { node: { kind: "map", entries, line, column: col }, end };
      }
      // Plain scalar inside a flow collection, or the whole value.
      const stop = /[,\]}]|:(\s|$)/.exec(s.slice(start));
      const endIdx = stop === null ? s.length : start + stop.index;
      const raw = s.slice(start, endIdx).trim();
      return {
        node: scalar(typePlain(raw), raw, false, line, col),
        end: endIdx,
      };
    };

    const first = s.charAt(0);
    if (first === "[" || first === "{" || first === '"' || first === "'") {
      const r = flow(0);
      if (s.slice(r.end).trim() !== "") {
        return failIn("unexpected text after value", r.end);
      }
      return r.node;
    }
    if ("&*!%@`".includes(first)) {
      return failIn(
        "anchors, aliases, tags and reserved indicators are not supported",
        0,
      );
    }
    return scalar(typePlain(s), s, false, line, column);
  };

  /** Read a block scalar whose header is `header` on the current line; consumes its lines. */
  const parseBlockScalar = (
    header: string,
    parentIndent: number,
    line: number,
    column: number,
  ): YScalar => {
    const m = /^([|>])([-+]?)$/.exec(header);
    if (m === null) {
      return failAt(
        "explicit indentation indicators are not supported",
        line,
        column,
      );
    }
    const folded = m[1] === ">";
    const chomp = m[2] ?? "";
    pos += 1;
    const body: Line[] = [];
    const collect = (): void => {
      const l = lines[pos];
      if (l === undefined) return;
      if (l.raw.trim() !== "" && l.indent <= parentIndent) return;
      body.push(l);
      pos += 1;
      collect();
    };
    collect();
    const firstText = body.find((l) => l.raw.trim() !== "");
    if (firstText === undefined) {
      return scalar("", "", true, line, column);
    }
    const blockIndent = firstText.indent;
    const content = body.map((l) =>
      l.raw.trim() === "" ? "" : l.raw.slice(blockIndent),
    );
    const trailing = content.length - content.findLastIndex((c) => c !== "") - 1;
    const kept = content.slice(0, content.length - trailing);
    const joined = folded
      ? kept.reduce((out, l, i) => {
          if (i === 0) return l;
          const prev = kept[i - 1] ?? "";
          if (l === "") return out + "\n";
          if (prev === "") return out + l;
          if (isSpace(l.charAt(0)) || isSpace(prev.charAt(0))) {
            return out + "\n" + l;
          }
          return out + " " + l;
        }, "")
      : kept.join("\n");
    const tail =
      chomp === "-" ? "" : chomp === "+" ? "\n".repeat(1 + trailing) : "\n";
    const text = joined + tail;
    return scalar(text, text, true, line, column);
  };

  const parseNode = (minIndent: number): YNode | undefined => {
    const l = peek();
    if (l === undefined || l.indent < minIndent) return undefined;
    if (isSeqLine(l)) return parseSeq(l.indent);
    const failKey = (m: string, at: number): never =>
      failAt(m, l.no, l.indent + 1 + at);
    if (splitKey(l.content, failKey) !== undefined) return parseMap(l.indent);
    pos += 1;
    return parseInline(l.content, l.no, l.indent + 1);
  };

  /** The value of a `key:` or `-` whose same-line remainder is empty. */
  const parseNested = (
    indent: number,
    line: number,
    column: number,
    allowSameIndentSeq: boolean,
  ): YNode => {
    pos += 1;
    const next = peek();
    if (next !== undefined && next.indent > indent) {
      return parseNode(next.indent) ?? scalar(null, "", false, line, column);
    }
    if (
      allowSameIndentSeq &&
      next !== undefined &&
      next.indent === indent &&
      isSeqLine(next)
    ) {
      return parseSeq(indent);
    }
    return scalar(null, "", false, line, column);
  };

  const rejectContinuation = (indent: number): void => {
    const next = peek();
    if (next !== undefined && next.indent > indent) {
      failAt(
        "multi-line plain or quoted scalars are not supported",
        next.no,
        next.indent + 1,
      );
    }
  };

  const parseMap = (indent: number): YMap => {
    const first = peek();
    const entries: YEntry[] = [];
    const loop = (): void => {
      const l = peek();
      if (l === undefined || l.indent < indent) return;
      if (l.indent > indent) {
        failAt("unexpected indentation", l.no, l.indent + 1);
      }
      const failKey = (m: string, at: number): never =>
        failAt(m, l.no, l.indent + 1 + at);
      const kd = splitKey(l.content, failKey);
      if (kd === undefined) {
        failAt("expected 'key: value'", l.no, l.indent + 1);
        return;
      }
      if (entries.some((e) => e.key === kd.key)) {
        failAt(`duplicate key '${kd.key}'`, l.no, l.indent + 1);
      }
      const rest = kd.rest.trim();
      const restCol = l.indent + 1 + kd.restAt + (kd.rest.length - kd.rest.trimStart().length);
      const value: YNode =
        rest === ""
          ? parseNested(indent, l.no, l.indent + 1 + kd.restAt, true)
          : rest.startsWith("|") || rest.startsWith(">")
            ? parseBlockScalar(rest, indent, l.no, restCol)
            : (() => {
                const v = parseInline(rest, l.no, restCol);
                pos += 1;
                rejectContinuation(indent);
                return v;
              })();
      entries.push({
        key: kd.key,
        keyLine: l.no,
        keyColumn: l.indent + 1,
        value,
      });
      loop();
    };
    loop();
    return {
      kind: "map",
      entries,
      line: first?.no ?? firstLine,
      column: (first?.indent ?? 0) + 1,
    };
  };

  const parseSeq = (indent: number): YSeq => {
    const first = peek();
    const items: YNode[] = [];
    const loop = (): void => {
      const l = peek();
      if (l === undefined || l.indent < indent) return;
      if (l.indent > indent || !isSeqLine(l)) {
        if (l.indent === indent) return;
        failAt("unexpected indentation", l.no, l.indent + 1);
        return;
      }
      const afterDash = l.content.slice(1);
      const rest = afterDash.trimStart();
      const itemIndent = l.indent + 1 + (afterDash.length - rest.length);
      const failKey = (m: string, at: number): never =>
        failAt(m, l.no, itemIndent + 1 + at);
      const item: YNode = (() => {
        if (rest === "") return parseNested(indent, l.no, itemIndent + 1, false);
        if (rest.startsWith("|") || rest.startsWith(">")) {
          return parseBlockScalar(rest, indent, l.no, itemIndent + 1);
        }
        if (rest === "-" || rest.startsWith("- ")) {
          lines[pos] = { ...l, indent: itemIndent, content: rest };
          return parseSeq(itemIndent);
        }
        if (splitKey(rest, failKey) !== undefined) {
          lines[pos] = { ...l, indent: itemIndent, content: rest };
          return parseMap(itemIndent);
        }
        const v = parseInline(rest, l.no, itemIndent + 1);
        pos += 1;
        rejectContinuation(indent);
        return v;
      })();
      items.push(item);
      loop();
    };
    loop();
    return {
      kind: "seq",
      items,
      line: first?.no ?? firstLine,
      column: (first?.indent ?? 0) + 1,
    };
  };

  try {
    const head = peek();
    if (head !== undefined && head.content === "---" && head.indent === 0) {
      pos += 1;
    }
    const value = parseNode(0);
    const extra = peek();
    if (extra !== undefined) {
      failAt("unexpected content", extra.no, extra.indent + 1);
    }
    return { ok: true, value };
  } catch (e) {
    if (e instanceof YamlError) {
      return { ok: false, message: e.message, line: e.line, column: e.column };
    }
    throw e;
  }
};
