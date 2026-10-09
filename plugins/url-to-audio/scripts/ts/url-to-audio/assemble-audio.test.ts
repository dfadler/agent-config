import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main, realDeps, type Deps } from "./assemble-audio.ts";

const SCRIPT = join(import.meta.dirname, "assemble-audio.ts");

const fakeDeps = (ffmpeg: Deps["ffmpeg"] = () => ({ missing: false, status: 0 })) => {
  const copies: [string, string][] = [];
  const ffmpegCalls: string[][] = [];
  const err: string[] = [];
  const deps: Deps = {
    copyFile: (a, b) => copies.push([a, b]),
    ffmpeg: (args) => {
      ffmpegCalls.push(args);
      return ffmpeg(args);
    },
    out: () => undefined,
    errOut: (s) => err.push(s),
  };
  return { deps, copies, ffmpegCalls, err };
};

describe("main (injected effects)", () => {
  it.each([[["w", "1"]], [["w", "x", "0"]], [["w", "1", "2"]]])("exits 2 on bad args %j", (argv) => {
    const f = fakeDeps();
    expect(main(argv, f.deps)).toBe(2);
    expect(f.copies).toEqual([]);
    expect(f.ffmpegCalls).toEqual([]);
  });

  it("failed=1 aborts before touching anything, even for one chunk", () => {
    for (const total of ["1", "3"]) {
      const f = fakeDeps();
      expect(main(["w", total, "1"], f.deps)).toBe(1);
      expect(f.copies).toEqual([]);
      expect(f.ffmpegCalls).toEqual([]);
    }
  });

  it("copies a single chunk without invoking ffmpeg", () => {
    const f = fakeDeps();
    expect(main(["w", "1", "0"], f.deps)).toBe(0);
    expect(f.copies).toEqual([[join("w", "part_0001.mp3"), join("w", "article.mp3")]]);
    expect(f.ffmpegCalls).toEqual([]);
  });

  it("reports a failed single-chunk copy", () => {
    const f = fakeDeps();
    const deps: Deps = {
      ...f.deps,
      copyFile: () => {
        throw new Error("ENOENT part_0001.mp3");
      },
    };
    expect(main(["w", "1", "0"], deps)).toBe(1);
    expect(f.err.join("")).toContain("ENOENT");
  });

  it("concatenates multiple chunks via ffmpeg and passes its status through", () => {
    const f = fakeDeps(() => ({ missing: false, status: 0 }));
    expect(main(["w", "2", "0"], f.deps)).toBe(0);
    expect(f.ffmpegCalls[0]).toEqual(["-y", "-f", "concat", "-safe", "0", "-i", join("w", "concat.txt"), "-c", "copy", join("w", "article.mp3")]);
    expect(main(["w", "2", "0"], fakeDeps(() => ({ missing: false, status: 3 })).deps)).toBe(3);
  });

  it("refuses when ffmpeg is missing and there is more than one chunk", () => {
    const f = fakeDeps(() => ({ missing: true, status: 1 }));
    expect(main(["w", "2", "0"], f.deps)).toBe(1);
    expect(f.err.join("")).toContain("ffmpeg not found");
  });
});

describe("CLI against a PATH shim", () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), "assemble-audio-"));
    const work = join(root, "work");
    const bin = join(root, "bin");
    mkdirSync(work);
    mkdirSync(bin);
    return { root, work, bin };
  };
  const shimFfmpeg = (bin: string) => {
    const path = join(bin, "ffmpeg");
    writeFileSync(path, '#!/bin/sh\nfor a; do out="$a"; done\necho concatenated > "$out"\n');
    chmodSync(path, 0o755);
  };
  // PATH holds only the shim dir plus the directory of the running node.
  const run = (bin: string, args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { PATH: `${bin}:${dirname(process.execPath)}` },
    });

  it("concatenates through the real ffmpeg lookup", () => {
    const { work, bin } = setup();
    shimFfmpeg(bin);
    const r = run(bin, [work, "2", "0"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(work, "article.mp3"), "utf8")).toBe("concatenated\n");
  });

  it("refuses with no ffmpeg on PATH and writes nothing", () => {
    const { work, bin } = setup();
    const r = run(bin, [work, "2", "0"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ffmpeg not found");
    expect(existsSync(join(work, "article.mp3"))).toBe(false);
  });

  it("copies one chunk with no ffmpeg installed", () => {
    const { work, bin } = setup();
    writeFileSync(join(work, "part_0001.mp3"), "fake-audio");
    const r = run(bin, [work, "1", "0"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(work, "article.mp3"), "utf8")).toBe("fake-audio");
  });
});

describe("realDeps (in-process, so coverage sees it)", () => {
  const withPath = (path: string, fn: () => void) => {
    const old = process.env.PATH;
    process.env.PATH = path;
    try {
      fn();
    } finally {
      process.env.PATH = old;
    }
  };
  const shim = (body: string) => {
    const bin = mkdtempSync(join(tmpdir(), "assemble-audio-real-"));
    const path = join(bin, "ffmpeg");
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return bin;
  };

  it("ffmpeg reports missing when not on PATH", () => {
    withPath(mkdtempSync(join(tmpdir(), "empty-")), () => {
      expect(realDeps.ffmpeg([])).toEqual({ missing: true, status: 1 });
    });
  });

  it("ffmpeg passes through the exit status of the real process", () => {
    withPath(shim("exit 3"), () => {
      expect(realDeps.ffmpeg([])).toEqual({ missing: false, status: 3 });
    });
  });

  it("out and errOut write to the process streams", () => {
    const o = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const e = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      realDeps.out("hello");
      realDeps.errOut("oops");
      expect(o).toHaveBeenCalledWith("hello");
      expect(e).toHaveBeenCalledWith("oops");
    } finally {
      o.mockRestore();
      e.mockRestore();
    }
  });
});
