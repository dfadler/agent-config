import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { end, main, MARKER_NAME, start } from "./timing.ts";
import { fakeIo, readObj } from "./test-io.ts";

const T0 = new Date("2025-01-01T10:00:00.900Z");
const T1 = new Date("2025-01-01T10:01:30.100Z");

describe("start / end", () => {
  it("truncates to whole UTC seconds", () => {
    expect(start(T0)).toEqual({ epoch: 1735725600, iso: "2025-01-01T10:00:00Z" });
  });

  it("computes the duration between a marker and now", () => {
    expect(end(start(T0), T1)).toEqual({
      duration_seconds: 90,
      start_iso: "2025-01-01T10:00:00Z",
      end_iso: "2025-01-01T10:01:30Z",
    });
  });
});

describe("main", () => {
  const tmp = (): string => join(mkdtempSync(join(tmpdir(), "timing-")), "outputs");

  it("--start writes the marker; --end writes the result and removes the marker", () => {
    const dir = tmp();
    const a = fakeIo();
    expect(main(["--start", dir], a.io, T0)).toBe(0);
    expect(a.out()).toBe("Render timing started at 2025-01-01T10:00:00Z\n");
    expect(readObj(join(dir, MARKER_NAME))).toEqual(start(T0));

    const b = fakeIo();
    expect(main(["--end", dir], b.io, T1)).toBe(0);
    const written = readObj(join(dir, "render_timing.json"));
    expect(written.duration_seconds).toBe(90);
    expect(JSON.parse(b.out())).toEqual(written);
    expect(existsSync(join(dir, MARKER_NAME))).toBe(false);
  });

  it("--end without a marker warns and exits 0 without writing", () => {
    const dir = tmp();
    const a = fakeIo();
    expect(main(["--end", dir], a.io, T1)).toBe(0);
    expect(a.err()).toContain("not found");
    expect(existsSync(join(dir, "render_timing.json"))).toBe(false);
  });

  it("--end rejects a malformed marker", () => {
    const dir = tmp();
    main(["--start", dir], fakeIo().io, T0);
    writeFileSync(join(dir, MARKER_NAME), '{"epoch":"x"}');
    const a = fakeIo();
    expect(main(["--end", dir], a.io, T1)).toBe(1);
    expect(a.err()).toContain("malformed");
  });

  it.each([[[]], [["--start"]], [["--bogus", "d"]], [["--start", "d", "extra"]]])(
    "exits 1 on bad usage %j",
    (argv) => {
      expect(main(argv, fakeIo().io)).toBe(1);
    },
  );
});
