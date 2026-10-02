import { describe, expect, it } from "vitest";
import { describeThrown } from "./thrown.ts";

describe("describeThrown", () => {
  it("uses an Error's message", () => {
    expect(describeThrown(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(describeThrown("plain")).toBe("plain");
    expect(describeThrown(42)).toBe("42");
  });
});
