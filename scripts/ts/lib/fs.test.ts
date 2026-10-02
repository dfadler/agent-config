import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXIT_FAILURE } from "./exit-codes.ts";
import { readTextFile } from "./fs.ts";

const dir = mkdtempSync(join(tmpdir(), "fs-test-"));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readTextFile", () => {
  it("returns the file contents as ok", () => {
    const path = join(dir, "a.txt");
    writeFileSync(path, "héllo\n");
    expect(readTextFile(path)).toEqual({ tag: "ok", value: "héllo\n" });
  });

  it("returns err with EXIT_FAILURE naming the path when unreadable", () => {
    const path = join(dir, "missing.txt");
    const r = readTextFile(path);
    expect(r.tag).toBe("err");
    if (r.tag === "err") {
      expect(r.error.code).toBe(EXIT_FAILURE);
      expect(r.error.message).toContain(`cannot read ${path}:`);
      expect(r.error.message).toContain("ENOENT");
    }
  });
});
