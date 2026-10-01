import assert from "node:assert/strict";
import { test } from "node:test";
import { hashText } from "./hash.ts";

test("hashText matches the known SHA-256 of the empty string", () => {
  assert.equal(
    hashText(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("hashText is deterministic and sensitive to content", () => {
  assert.equal(hashText("a"), hashText("a"));
  assert.notEqual(hashText("a"), hashText("b"));
});
