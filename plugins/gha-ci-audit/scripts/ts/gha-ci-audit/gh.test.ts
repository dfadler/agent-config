import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { realGh } from "./gh.ts";

const ORIGINAL_PATH = process.env["PATH"];
afterEach(() => {
  if (ORIGINAL_PATH === undefined) delete process.env["PATH"];
  else process.env["PATH"] = ORIGINAL_PATH;
});

/** Put a fake `gh` first on PATH. */
const shim = (script: string): void => {
  const bin = mkdtempSync(join(tmpdir(), "gh-shim-"));
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  process.env["PATH"] = `${bin}:${ORIGINAL_PATH ?? ""}`;
};

describe("realGh", () => {
  it("runs `gh api <args>` and returns stdout", () => {
    shim('#!/bin/sh\necho "$@"\n');
    expect(realGh(["repos/o/r", "--jq", ".x"])).toBe("api repos/o/r --jq .x\n");
  });

  it("returns output larger than spawnSync's 1 MB default", () => {
    shim("#!/bin/sh\nhead -c 2000000 /dev/zero | tr '\\0' x\n");
    expect(realGh(["big"]).length).toBe(2000000);
  });

  it("throws with stderr on a non-zero exit", () => {
    shim('#!/bin/sh\necho "HTTP 404" >&2\nexit 1\n');
    expect(() => realGh(["repos/o/r"])).toThrow("gh api repos/o/r failed: HTTP 404");
  });

  it("throws when gh is not installed", () => {
    process.env["PATH"] = mkdtempSync(join(tmpdir(), "no-gh-"));
    expect(() => realGh(["x"])).toThrow(/ENOENT/);
  });
});
