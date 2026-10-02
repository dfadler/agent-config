import { describe, expect, it } from "vitest";
import * as parser from "./index.ts";

// Guards the frozen surface: #452 and #487 replace bodies, never rename or drop
// an export. Type-level compatibility is checked by `tsc --noEmit`.
describe("parser surface", () => {
  const expected = [
    "getSchema",
    "resolveEvalDir",
    "readCase",
    "readSuite",
    "readGrantsFile",
    "grantsForCase",
    "readAggregateResult",
    "parseAllowedTool",
    "isScored",
    "scoreCase",
    "graderCategory",
    "readPluginManifest",
    "readMocks",
    "resolveCasePath",
  ];

  it.each(expected)("exports %s as a function", (name) => {
    expect(typeof Object.entries(parser).find(([k]) => k === name)?.[1]).toBe(
      "function",
    );
  });
});
