import assert from "node:assert/strict";
import { test } from "vitest";
import { hashText } from "./hash.ts";

test("hashText matches the standard SHA-256 vectors", () => {
  assert.equal(
    hashText(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    hashText("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("hashText is deterministic and sensitive to content", () => {
  assert.equal(hashText("a"), hashText("a"));
  assert.notEqual(hashText("a"), hashText("b"));
});
