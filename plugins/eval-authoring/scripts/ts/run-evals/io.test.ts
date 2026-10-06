import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findExecutables, nodeIo, spawnProcess } from "./io.ts";

describe("spawnProcess", () => {
  it("captures output and status, and tees chunks", async () => {
    const seen: string[] = [];
    const r = await spawnProcess(
      process.execPath,
      ["-e", "process.stdout.write('o');process.stderr.write('e');process.exit(3)"],
      { onStdout: (c) => seen.push(`out:${c}`), onStderr: (c) => seen.push(`err:${c}`) },
    );
    expect(r).toMatchObject({ status: 3, stdout: "o", stderr: "e", error: undefined });
    expect(seen.sort()).toEqual(["err:e", "out:o"]);
  });
  it("reports a signal death", async () => {
    const r = await spawnProcess(process.execPath, ["-e", "process.kill(process.pid,'SIGTERM')"]);
    expect(r.signal).toBe("SIGTERM");
    expect(r.status).toBeNull();
  });
  it("reports a command that cannot start", async () => {
    const r = await spawnProcess("/no/such/command-xyz", []);
    expect(r.status).toBeNull();
    expect(r.error).toContain("ENOENT");
  });
});

describe("findExecutables", () => {
  it("finds every match in PATH order and de-duplicates symlinks", () => {
    const root = mkdtempSync(join(tmpdir(), "run-evals-path-"));
    const a = join(root, "a");
    const b = join(root, "b");
    const c = join(root, "c");
    [a, b, c].forEach((d) => {
      mkdirSync(d);
    });
    writeFileSync(join(a, "tool"), "#!/bin/sh\n");
    chmodSync(join(a, "tool"), 0o755);
    symlinkSync(join(a, "tool"), join(b, "tool"));
    writeFileSync(join(c, "tool"), "#!/bin/sh\n");
    chmodSync(join(c, "tool"), 0o755);
    const found = findExecutables("tool", [a, b, c, "/nonexistent"].join(":"), "linux");
    expect(found).toHaveLength(2);
    expect(found[0]?.endsWith("/a/tool")).toBe(true);
    expect(found[1]?.endsWith("/c/tool")).toBe(true);
  });
  it("tries Windows suffixes on win32", () => {
    const seen: string[] = [];
    findExecutables("claude", "C:\\bin;D:\\bin", "win32", (p) => {
      seen.push(p);
      return false;
    });
    expect(seen.some((p) => p.endsWith("claude.exe"))).toBe(true);
    expect(seen).toHaveLength(8);
  });
});

describe("nodeIo", () => {
  it("reads, writes and lists through the filesystem", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-evals-io-"));
    const io = nodeIo({ PATH: "" });
    io.writeFile(join(dir, "x", "f.txt"), "hi");
    expect(io.readFile(join(dir, "x", "f.txt"))).toBe("hi");
    expect(io.readFile(join(dir, "missing"))).toBeUndefined();
    expect(io.listDir(join(dir, "x"))).toEqual(["f.txt"]);
    expect(io.listDir(join(dir, "missing"))).toEqual([]);
    expect(io.realpath(join(dir, "nope"))).toBe(join(dir, "nope"));
    expect(io.findOnPath("anything")).toEqual([]);
  });
});
