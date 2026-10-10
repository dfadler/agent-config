import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./write-assertions.ts";
import { fakeIo, readObj } from "./test-io.ts";

const setup = (evals: unknown, withMeta = true) => {
  const root = mkdtempSync(join(tmpdir(), "write-assertions-"));
  const iter = join(root, "iteration-1");
  const runDir = join(iter, "vite-audit", "with_skill");
  mkdirSync(runDir, { recursive: true });
  if (withMeta) writeFileSync(join(runDir, "eval_metadata.json"), JSON.stringify({ eval_id: 1, eval_name: "vite-audit", assertions: [] }));
  const evalsJson = join(root, "evals.json");
  writeFileSync(evalsJson, JSON.stringify(evals));
  return { iter, evalsJson, meta: join(runDir, "eval_metadata.json") };
};

const A = { id: "artifact_published", text: "Report published" };

describe("main", () => {
  it("writes each eval's assertions into its metadata, keeping other fields", () => {
    const s = setup({ evals: [{ id: 1, dir_name: "vite-audit", assertions: [A] }] });
    const io = fakeIo();
    expect(main([s.iter, s.evalsJson], io.io)).toBe(0);
    expect(readObj(s.meta)).toEqual({ eval_id: 1, eval_name: "vite-audit", assertions: [A] });
    expect(io.out()).toBe("Populated vite-audit: 1 assertions\n");
  });

  it("writes an empty list when an eval has no assertions", () => {
    const s = setup({ evals: [{ id: 1, dir_name: "vite-audit" }] });
    expect(main([s.iter, s.evalsJson], fakeIo().io)).toBe(0);
    expect(readObj(s.meta)["assertions"]).toEqual([]);
  });

  it("skips an eval with no dir_name, and one whose metadata is missing", () => {
    const s = setup({ evals: [{ id: 5, assertions: [] }, { id: 6, dir_name: "other", assertions: [A] }, "junk"] });
    const io = fakeIo();
    expect(main([s.iter, s.evalsJson], io.io)).toBe(0);
    expect(io.err()).toContain("Missing dir_name for eval id 5, skipping");
    expect(main([s.iter, setup({ evals: [{ id: 7, dir_name: "", assertions: [] }] }).evalsJson], io.io)).toBe(0);
    expect(io.err()).toContain("Missing dir_name for eval id 7, skipping");
    expect(io.err()).toContain("other");
    expect(io.err()).toContain("skipping");
    expect(io.out()).toBe("");
  });

  it("exits 1 on a non-object metadata file", () => {
    const s = setup({ evals: [{ id: 1, dir_name: "vite-audit", assertions: [A] }] });
    writeFileSync(s.meta, "[]");
    expect(main([s.iter, s.evalsJson], fakeIo().io)).toBe(1);
  });

  it("exits 1 on an unreadable or malformed evals.json and on bad usage", () => {
    const s = setup({ not: "evals" });
    const io = fakeIo();
    expect(main([s.iter, s.evalsJson], io.io)).toBe(1);
    expect(io.err()).toContain("cannot read");
    expect(main([s.iter, "/nonexistent/evals.json"], fakeIo().io)).toBe(1);
    expect(main([s.iter], fakeIo().io)).toBe(1);
    expect(main([s.iter, s.evalsJson, "extra"], fakeIo().io)).toBe(1);
  });
});
