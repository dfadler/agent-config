import { expect, test } from "vitest";
import { hashText } from "./hash.ts";

test("hashText matches the known SHA-256 of the empty string", () => {
  expect(hashText("")).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("hashText is deterministic and sensitive to content", () => {
  expect(hashText("a")).toBe(hashText("a"));
  expect(hashText("a")).not.toBe(hashText("b"));
});
