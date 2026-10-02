/**
 * Internal JSON reading shared by the manifest and mock readers (#487). Not
 * exported from index.ts: rules read through `readPluginManifest` and `readMocks`.
 */
import { readFileSync } from "node:fs";
import type { ParseIssue } from "./types.ts";

/** Narrow an unknown JSON value to a plain object. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON file's text and parsed value, or the issue explaining why not. */
export type JsonRead =
  | { readonly ok: true; readonly text: string; readonly value: unknown }
  | {
      readonly ok: false;
      readonly issue: ParseIssue;
      /** True when the file does not exist (not an error for an optional file). */
      readonly missing: boolean;
    };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

/** Read and parse `file`. Never throws. */
export const readJsonFile = (file: string): JsonRead => {
  const loc = { file, line: 1 };
  try {
    const text = readFileSync(file, "utf8");
    try {
      return { ok: true, text, value: JSON.parse(text) };
    } catch (error) {
      return {
        ok: false,
        missing: false,
        issue: {
          kind: "unreadable-file",
          message: `invalid JSON: ${messageOf(error)}`,
          loc,
        },
      };
    }
  } catch (error) {
    return {
      ok: false,
      missing: isNotFound(error),
      issue: {
        kind: "unreadable-file",
        message: `cannot read file: ${messageOf(error)}`,
        loc,
      },
    };
  }
};

/** 1-based line of the first occurrence of `needle` at or after character `from`; undefined when absent. */
export const lineOf = (
  text: string,
  needle: string,
  from = 0,
): number | undefined => {
  const index = text.indexOf(needle, from);
  return index === -1 ? undefined : text.slice(0, index).split("\n").length;
};
