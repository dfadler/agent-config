import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./merge-timing.ts";
import { fakeIo, readObj } from "./test-io.ts";

const setup = (files: Record<string, object>): { root: string; outputs: string } => {
  const root = mkdtempSync(join(tmpdir(), "merge-timing-"));
  const outputs = join(root, "outputs");
  mkdirSync(outputs);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(outputs, name), JSON.stringify(body));
  return { root, outputs };
};

const collect = { duration_seconds: 30, start_iso: "2025-01-01T10:00:00Z", end_iso: "2025-01-01T10:00:30Z" };
const render = { duration_seconds: 20, start_iso: "2025-01-01T10:01:00Z", end_iso: "2025-01-01T10:01:20Z" };

describe("main", () => {
  it("merges both phases into <outputs>/../timing.json", () => {
    const { root, outputs } = setup({ "collect_timing.json": collect, "render_timing.json": render });
    const a = fakeIo();
    expect(main([outputs], a.io)).toBe(0);
    const timing = readObj(join(root, "timing.json"));
    expect(timing).toEqual({
      collect_duration_seconds: 30,
      render_duration_seconds: 20,
      total_duration_seconds: 50,
      collect_start_iso: "2025-01-01T10:00:00Z",
      collect_end_iso: "2025-01-01T10:00:30Z",
      render_start_iso: "2025-01-01T10:01:00Z",
      render_end_iso: "2025-01-01T10:01:20Z",
    });
    expect(JSON.parse(a.out())).toEqual(timing);
    expect(a.err()).toContain("Written to");
  });

  it("handles a single phase, leaving the other null", () => {
    const { root, outputs } = setup({ "render_timing.json": render });
    expect(main([outputs], fakeIo().io)).toBe(0);
    const timing = readObj(join(root, "timing.json"));
    expect(timing.collect_duration_seconds).toBeNull();
    expect(timing.total_duration_seconds).toBe(20);
    expect(timing.collect_start_iso).toBeNull();
  });

  it("exits 1 when neither file exists", () => {
    const { outputs } = setup({});
    const a = fakeIo();
    expect(main([outputs], a.io)).toBe(1);
    expect(a.err()).toContain("No timing files found");
  });

  it("exits 1 on missing or extra arguments", () => {
    expect(main([], fakeIo().io)).toBe(1);
    expect(main(["a", "b"], fakeIo().io)).toBe(1);
  });
});
