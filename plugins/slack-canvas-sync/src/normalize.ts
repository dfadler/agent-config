/**
 * Canonical form for canvas markdown.
 *
 * Slack rewrites markdown on read (`-` bullets become `*`, blank lines appear
 * after headings, table spacing changes, h4+ headings become h3), so raw text
 * from a local file and from `slack_read_canvas` can never be compared
 * directly. Both sides go through this module first; the result is what gets
 * hashed and diffed.
 */

/** First line of the generated navigation callout. Stripped before hashing. */
export const NAV_BLOCK_HEADER = ":compass: **Navigation**";

/** Slack clamps deeper headings to this level on write. */
export const MAX_HEADING_LEVEL = 3;

export interface Normalized {
  /** Canvas title, or null when the input did not carry one. */
  title: string | null;
  /** Canonical body markdown: one trailing newline, or "" when empty. */
  body: string;
  /** The body as top-level blocks, one per Slack canvas section. */
  sections: string[];
}

const FENCE = /^(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK = /^(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const CHECKBOX = /^\[([ xX])\][ \t]+(.*)$/;
const TABLE_SEPARATOR = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?$/;

/**
 * True for a table's header/body separator row (`|---|:-:|`). Requires a pipe
 * so a bare `---` under a line of text is never mistaken for one.
 */
export function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && TABLE_SEPARATOR.test(trimmed);
}
const CONTAINER_OPEN = /^:::[ \t]*\{.*\}[ \t]*$/;
const CONTAINER_CLOSE = /^:::[ \t]*$/;

type ListKind = "bullet" | "ordered" | "check";

interface ListItem {
  kind: ListKind;
  indent: number;
  checked: boolean;
  text: string;
}

function expandTabs(line: string): string {
  return line.replace(/\t/g, "    ");
}

function parseListItem(line: string): ListItem | null {
  const match = LIST_ITEM.exec(expandTabs(line));
  if (match === null) return null;
  const indent = (match[1] ?? "").length;
  const marker = match[2] ?? "";
  const content = (match[3] ?? "").trim();
  if (/^\d/.test(marker)) {
    return { kind: "ordered", indent, checked: false, text: content };
  }
  const checkbox = CHECKBOX.exec(content);
  if (checkbox !== null) {
    return {
      kind: "check",
      indent,
      checked: (checkbox[1] ?? " ") !== " ",
      text: (checkbox[2] ?? "").trim(),
    };
  }
  return { kind: "bullet", indent, checked: false, text: content };
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function splitCells(row: string): string[] {
  let trimmed = row.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function renderTable(rows: string[]): string {
  const header = splitCells(rows[0] ?? "");
  const separator = header.map(() => "  ---  ");
  const body = rows.slice(2).map(splitCells);
  return [
    `|${header.join("|")}|`,
    `|${separator.join("|")}|`,
    ...body.map((cells) => `|${cells.join("|")}|`),
  ].join("\n");
}

function renderList(items: ListItem[]): string {
  const stack: number[] = [];
  const counters: number[] = [];
  const out: string[] = [];
  for (const item of items) {
    const top = stack[stack.length - 1];
    if (top === undefined || item.indent > top) {
      stack.push(item.indent);
      counters.length = stack.length;
      counters[stack.length - 1] = 0;
    } else {
      while (stack.length > 1 && item.indent < (stack[stack.length - 1] ?? 0)) {
        stack.pop();
      }
      counters.length = stack.length;
    }
    const depth = stack.length - 1;
    const count = (counters[depth] ?? 0) + 1;
    counters[depth] = count;
    const pad = "    ".repeat(depth);
    if (item.kind === "ordered") {
      out.push(`${pad}${String(count)}. ${item.text}`);
    } else if (item.kind === "check") {
      out.push(`${pad}* [${item.checked ? "x" : " "}] ${item.text}`);
    } else {
      out.push(`${pad}* ${item.text}`);
    }
  }
  return out.join("\n");
}

/**
 * Whether `line` closes a code fence opened with `opener` (the run of backticks
 * or tildes): the same character only, and at least as many of them. Shared by
 * the normalizer and the validator so they always agree where code ends.
 */
export function closesFence(line: string, opener: string): boolean {
  const char = opener.startsWith("`") ? "`" : "~";
  const trimmed = line.trim();
  return trimmed.length >= opener.length && trimmed.replaceAll(char, "") === "";
}

/** Whether `line` begins a different block, so a table or paragraph ends before it. */
export function startsOtherBlock(line: string, next: string | undefined): boolean {
  const trimmed = line.trim();
  return (
    FENCE.test(trimmed) ||
    HEADING.test(trimmed) ||
    THEMATIC_BREAK.test(trimmed) ||
    parseListItem(line) !== null ||
    trimmed.startsWith(">") ||
    CONTAINER_OPEN.test(trimmed) ||
    CONTAINER_CLOSE.test(trimmed) ||
    (trimmed.includes("|") &&
      next !== undefined &&
      isTableSeparator(next))
  );
}

/** Normalize a markdown body (no title handling). */
export function normalizeBody(markdown: string): string {
  return renderSections(normalizeSections(markdown));
}

/**
 * Normalize a markdown body and return it as top-level blocks. Slack stores
 * each block (paragraph, heading, list, table, code block, quote, divider,
 * callout) as its own canvas section, so this is the unit the sync diffs.
 */
export function normalizeSections(markdown: string): string[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  return parseBlocks(canonicalMentions(lines));
}

const USER_MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g;
const CHANNEL_MENTION = /<#(C[A-Z0-9]+)(?:\|[^>]*)?>/g;

/**
 * Slack takes mentions in canvas syntax (`![](@U123)`, `![](#C123)`) but reads
 * them back in message syntax (`<@U123>`, `<#C123>`), verified live for user
 * mentions. Both sides are rewritten to the canvas form so a mention is never
 * a difference. Fenced code is left alone.
 */
function canonicalMentions(lines: string[]): string[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const trimmed = line.trim();
    if (fence !== null) {
      if (trimmed.startsWith(fence) && /^[`~]+$/.test(trimmed)) fence = null;
      return line;
    }
    const open = FENCE.exec(trimmed);
    if (open !== null) {
      fence = open[1] ?? null;
      return line;
    }
    return line
      .replace(USER_MENTION, "![](@$1)")
      .replace(CHANNEL_MENTION, "![](#$1)");
  });
}

/** Join sections back into canonical body text. */
export function renderSections(sections: string[]): string {
  return sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
}

function parseBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();

    if (isBlank(line)) {
      i += 1;
      continue;
    }

    const fence = FENCE.exec(trimmed);
    if (fence !== null) {
      const marker = fence[1] ?? "```";
      const out = [trimmed];
      i += 1;
      while (i < lines.length) {
        const inner = (lines[i] ?? "").replace(/\s+$/, "");
        i += 1;
        if (closesFence(inner, marker)) {
          out.push(inner.trim());
          break;
        }
        out.push(inner);
      }
      blocks.push(out.join("\n"));
      continue;
    }

    if (CONTAINER_OPEN.test(trimmed)) {
      let depth = 1;
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        const inner = (lines[j] ?? "").trim();
        if (CONTAINER_OPEN.test(inner)) depth += 1;
        else if (CONTAINER_CLOSE.test(inner)) depth -= 1;
        j += 1;
      }
      const innerEnd = depth === 0 ? j - 1 : j;
      const inner = normalizeBody(lines.slice(i + 1, innerEnd).join("\n"));
      const parts = [trimmed];
      if (inner !== "") parts.push(inner.replace(/\n$/, ""));
      parts.push(":::");
      blocks.push(parts.join("\n"));
      i = j;
      continue;
    }

    if (THEMATIC_BREAK.test(trimmed)) {
      blocks.push("---");
      i += 1;
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading !== null) {
      const level = Math.min((heading[1] ?? "#").length, MAX_HEADING_LEVEL);
      blocks.push(`${"#".repeat(level)} ${heading[2] ?? ""}`);
      i += 1;
      continue;
    }

    if (parseListItem(line) !== null) {
      let run: ListItem[] = [];
      let topKind: ListKind | null = null;
      let topIndent = 0;
      while (i < lines.length) {
        const item = parseListItem((lines[i] ?? "").replace(/\s+$/, ""));
        if (item === null) break;
        if (topKind === null) {
          topKind = item.kind;
          topIndent = item.indent;
        } else if (item.indent <= topIndent && item.kind !== topKind) {
          // A different top-level list type starts a new list, which Slack
          // stores as its own section.
          blocks.push(renderList(run));
          run = [];
          topKind = item.kind;
          topIndent = item.indent;
        }
        run.push(item);
        i += 1;
      }
      blocks.push(renderList(run));
      continue;
    }

    if (trimmed.startsWith(">")) {
      const out: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith(">")) {
        const text = (lines[i] ?? "").trim().replace(/^>\s*/, "");
        out.push(text === "" ? ">" : `> ${text}`);
        i += 1;
      }
      blocks.push(out.join("\n"));
      continue;
    }

    const nextLine = lines[i + 1];
    if (
      trimmed.includes("|") &&
      nextLine !== undefined &&
      isTableSeparator(nextLine)
    ) {
      const rows: string[] = [];
      // The header and separator are always rows; after them a line that
      // starts another block (a list item, heading, quote, ...) ends the table
      // even if it happens to contain a pipe.
      while (
        i < lines.length &&
        (lines[i] ?? "").trim().includes("|") &&
        (rows.length < 2 || !startsOtherBlock(lines[i] ?? "", lines[i + 1]))
      ) {
        rows.push(lines[i] ?? "");
        i += 1;
      }
      blocks.push(renderTable(rows));
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = (lines[i] ?? "").replace(/\s+$/, "");
      if (isBlank(current)) break;
      if (paragraph.length > 0 && startsOtherBlock(current, lines[i + 1])) break;
      paragraph.push(current.trim());
      i += 1;
    }
    blocks.push(paragraph.join("\n"));
  }
  return blocks;
}

/** Remove the generated navigation callout if it is the first block. */
export function stripNavBlock(body: string): string {
  return renderSections(stripNavSection(normalizeSections(body)));
}

/** Drop the generated navigation callout when it is the first section. */
export function stripNavSection(sections: string[]): string[] {
  const first = sections[0];
  if (first?.startsWith(`::: {.callout}\n${NAV_BLOCK_HEADER}`) === true) {
    return sections.slice(1);
  }
  return sections;
}

function finish(title: string | null, rest: string): Normalized {
  const sections = stripNavSection(normalizeSections(rest));
  return { title, body: renderSections(sections), sections };
}

function splitFrontmatter(markdown: string): {
  title: string | null;
  rest: string;
} {
  const text = markdown.replace(/\r\n?/g, "\n");
  if (!text.startsWith("---\n")) return { title: null, rest: text };
  const end = text.indexOf("\n---\n", 3);
  if (end === -1) return { title: null, rest: text };
  const block = text.slice(4, end);
  const match = /^title:[ \t]*(.+?)[ \t]*$/m.exec(block);
  const raw = match?.[1] ?? null;
  const title = raw === null ? null : raw.replace(/^(["'])(.*)\1$/, "$2");
  return { title, rest: text.slice(end + "\n---\n".length) };
}

function takeLeadingTitle(body: string): { title: string | null; rest: string } {
  const lines = body.split("\n");
  let first = 0;
  while (first < lines.length && isBlank(lines[first] ?? "")) first += 1;
  const match = /^#[ \t]+(.+?)[ \t]*$/.exec(lines[first] ?? "");
  if (match === null) return { title: null, rest: body };
  return { title: match[1] ?? null, rest: lines.slice(first + 1).join("\n") };
}

/**
 * Normalize a local markdown file.
 *
 * Frontmatter is dropped. The canvas title is the frontmatter `title`; with
 * none, a leading `# Heading` is taken as the title and removed from the body.
 */
export function normalizeLocal(markdown: string): Normalized {
  const { title: fmTitle, rest } = splitFrontmatter(markdown);
  if (fmTitle !== null) return finish(fmTitle, rest);
  const { title, rest: afterTitle } = takeLeadingTitle(rest);
  return finish(title, afterTitle);
}

/** Normalize `slack_read_canvas` output: the first `# line` is the title. */
export function normalizeRemote(markdown: string): Normalized {
  const { title, rest } = takeLeadingTitle(markdown.replace(/\r\n?/g, "\n"));
  return finish(title, rest);
}
