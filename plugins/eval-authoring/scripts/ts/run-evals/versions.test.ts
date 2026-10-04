import { describe, expect, it } from "vitest";
import {
  MIN_CLAUDE_VERSION,
  MIN_GIT_VERSION,
  atLeast,
  formatVersion,
  parseVersion,
} from "./versions.ts";

describe("parseVersion", () => {
  it("reads claude and git version output", () => {
    expect(parseVersion("2.1.287 (Claude Code)")).toEqual({
      major: 2,
      minor: 1,
      patch: 287,
    });
    expect(parseVersion("git version 2.39.3 (Apple Git-145)")).toEqual({
      major: 2,
      minor: 39,
      patch: 3,
    });
  });
  it("defaults a missing patch to 0 and rejects text with no version", () => {
    expect(parseVersion("v2.31")).toEqual({ major: 2, minor: 31, patch: 0 });
    expect(parseVersion("nothing")).toBeUndefined();
  });
});

describe("atLeast", () => {
  it("compares major, then minor, then patch", () => {
    expect(formatVersion(MIN_CLAUDE_VERSION)).toBe("2.1.269");
    const v = (major: number, minor: number, patch: number) => ({
      major,
      minor,
      patch,
    });
    expect(atLeast(v(2, 1, 269), MIN_CLAUDE_VERSION)).toBe(true);
    expect(atLeast(v(2, 1, 268), MIN_CLAUDE_VERSION)).toBe(false);
    expect(atLeast(v(2, 2, 0), MIN_CLAUDE_VERSION)).toBe(true);
    expect(atLeast(v(3, 0, 0), MIN_CLAUDE_VERSION)).toBe(true);
    expect(atLeast(v(1, 99, 999), MIN_CLAUDE_VERSION)).toBe(false);
    expect(atLeast(v(2, 30, 9), MIN_GIT_VERSION)).toBe(false);
    expect(atLeast(v(2, 31, 0), MIN_GIT_VERSION)).toBe(true);
  });
});
