/**
 * Checks markdown against Slack's canvas rules and reports what would be
 * rejected or altered, instead of silently mangling it.
 *
 * Rules come from the `slack_create_canvas` tool description and the canvases
 * docs (https://docs.slack.dev/surfaces/canvases/).
 */

import { isTableSeparator } from "./normalize.ts";

export const MAX_CONTENT_CHARS = 1_048_576;
export const MAX_TABLE_CELLS = 300;

export type IssueCode =
  | "content-too-large"
  | "table-too-large"
  | "heading-in-list-item"
  | "code-block-in-list-item"
  | "mixed-list-nesting"
  | "table-in-layout"
  | "callout-in-layout"
  | "nested-callout"
  | "layout-in-callout"
  | "deep-heading";

export interface Issue {
  code: IssueCode;
  /** `error` content is rejected or broken by Slack; `warning` is altered. */
  severity: "error" | "warning";
  /** 1-based line in the input. 0 for whole-document issues. */
  line: number;
  message: string;
}

const FENCE = /^(`{3,}|~{3,})/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/;
const CONTAINER_OPEN = /^:::[ \t]*\{(.*)\}[ \t]*$/;
const CONTAINER_CLOSE = /^:::[ \t]*$/;

function indentOf(line: string): number {
  return (/^[ \t]*/.exec(line)?.[0] ?? "").replace(/\t/g, "    ").length;
}

function countCells(row: string): number {
  let trimmed = row.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split(/(?<!\\)\|/).length;
}

/** Return every canvas-rule violation in `markdown`, in line order. */
export function validate(markdown: string): Issue[] {
  const issues: Issue[] = [];
  if (markdown.length > MAX_CONTENT_CHARS) {
    issues.push({
      code: "content-too-large",
      severity: "error",
      line: 0,
      message: `content is ${String(markdown.length)} characters; the limit is ${String(MAX_CONTENT_CHARS)}`,
    });
  }

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const containers: ("callout" | "layout")[] = [];
  // Stack of list markers (true = ordered) by nesting depth, with indents.
  let listStack: { indent: number; ordered: boolean }[] = [];
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const lineNo = i + 1;
    const inListContext = listStack.length > 0 && indentOf(line) > 0;

    if (fence !== null) {
      if (trimmed.startsWith(fence) && /^[`~]+$/.test(trimmed)) fence = null;
      continue;
    }

    const fenceMatch = FENCE.exec(trimmed);
    if (fenceMatch !== null) {
      if (inListContext) {
        issues.push({
          code: "code-block-in-list-item",
          severity: "error",
          line: lineNo,
          message: "code blocks are not allowed inside list items",
        });
      }
      fence = fenceMatch[1] ?? "```";
      continue;
    }

    if (trimmed === "") {
      continue;
    }

    const open = CONTAINER_OPEN.exec(trimmed);
    if (open !== null) {
      const kind = /\.callout\b/.test(open[1] ?? "") ? "callout" : "layout";
      const parent = containers[containers.length - 1];
      if (kind === "callout" && parent === "callout") {
        issues.push({
          code: "nested-callout",
          severity: "error",
          line: lineNo,
          message: "callouts cannot be nested inside other callouts",
        });
      } else if (kind === "callout" && containers.includes("layout")) {
        issues.push({
          code: "callout-in-layout",
          severity: "error",
          line: lineNo,
          message: "callouts are not supported inside layouts or columns",
        });
      } else if (kind === "layout" && containers.includes("callout")) {
        issues.push({
          code: "layout-in-callout",
          severity: "error",
          line: lineNo,
          message: "layouts are not supported inside callouts",
        });
      }
      containers.push(kind);
      listStack = [];
      continue;
    }
    if (CONTAINER_CLOSE.test(trimmed)) {
      containers.pop();
      listStack = [];
      continue;
    }

    const heading = /^(#{1,6})[ \t]+/.exec(trimmed);
    if (heading !== null) {
      if (inListContext) {
        issues.push({
          code: "heading-in-list-item",
          severity: "error",
          line: lineNo,
          message: "headings are not allowed inside list items",
        });
      } else {
        listStack = [];
      }
      if ((heading[1] ?? "").length > 3) {
        issues.push({
          code: "deep-heading",
          severity: "warning",
          line: lineNo,
          message: "only h1-h3 are supported; Slack will turn this into an h3",
        });
      }
      continue;
    }

    const item = LIST_ITEM.exec(line.replace(/\t/g, "    "));
    if (item !== null) {
      const indent = (item[1] ?? "").length;
      const ordered = /^\d/.test(item[2] ?? "");
      const content = (item[3] ?? "").trim();
      while (
        listStack.length > 0 &&
        indent < (listStack[listStack.length - 1]?.indent ?? 0)
      ) {
        listStack.pop();
      }
      const current = listStack[listStack.length - 1];
      if (current !== undefined && indent === current.indent) {
        // A sibling of another type starts a new list; it is not nesting.
        current.ordered = ordered;
      } else if (current === undefined || indent > current.indent) {
        if (current !== undefined && current.ordered !== ordered) {
          issues.push({
            code: "mixed-list-nesting",
            severity: "error",
            line: lineNo,
            message: ordered
              ? "a numbered list cannot be nested inside a bulleted list"
              : "a bulleted list cannot be nested inside a numbered list",
          });
        }
        listStack.push({ indent, ordered });
      }
      if (/^#{1,6}[ \t]/.test(content)) {
        issues.push({
          code: "heading-in-list-item",
          severity: "error",
          line: lineNo,
          message: "headings are not allowed inside list items",
        });
      }
      if (FENCE.test(content)) {
        issues.push({
          code: "code-block-in-list-item",
          severity: "error",
          line: lineNo,
          message: "code blocks are not allowed inside list items",
        });
      }
      continue;
    }

    const next = lines[i + 1];
    if (
      trimmed.includes("|") &&
      next !== undefined &&
      isTableSeparator(next)
    ) {
      if (containers.includes("layout")) {
        issues.push({
          code: "table-in-layout",
          severity: "error",
          line: lineNo,
          message: "tables are not supported inside layouts or columns",
        });
      }
      let cells = 0;
      let j = i;
      while (j < lines.length && (lines[j] ?? "").trim().includes("|")) {
        if (j !== i + 1) cells += countCells(lines[j] ?? "");
        j += 1;
      }
      if (cells > MAX_TABLE_CELLS) {
        issues.push({
          code: "table-too-large",
          severity: "error",
          line: lineNo,
          message: `table has ${String(cells)} cells; the limit is ${String(MAX_TABLE_CELLS)}`,
        });
      }
      listStack = [];
      i = j - 1;
      continue;
    }

    // Plain paragraph text at column 0 ends any open list.
    if (indentOf(line) === 0) listStack = [];
  }

  return issues;
}
