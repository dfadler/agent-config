import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { findViewer, main, type Deps } from "./launch-viewer.ts";
import { fakeIo } from "./test-io.ts";

const tmp = (): string => realpathSync(mkdtempSync(join(tmpdir(), "launch-viewer-")));

/** <root>/skill-creator/eval-viewer/generate_review.py plus iteration dirs. */
const setup = (withViewer = true) => {
  const root = tmp();
  const creator = join(root, "skill-creator");
  mkdirSync(join(creator, "eval-viewer"), { recursive: true });
  if (withViewer) writeFileSync(join(creator, "eval-viewer", "generate_review.py"), "");
  mkdirSync(join(root, "iteration-1"));
  mkdirSync(join(root, "iteration-0"));
  return { root, creator, iter: join(root, "iteration-1"), prev: join(root, "iteration-0") };
};

interface Fake {
  deps: Deps;
  started: { args: string[]; log: string }[];
  killed: number[];
  slept: number[];
}

const fakeDeps = (creator: string, over: Partial<Deps> = {}): Fake => {
  const started: Fake["started"] = [];
  const killed: number[] = [];
  const slept: number[] = [];
  const deps: Deps = {
    env: { CLAUDE_SKILL_CREATOR_DIR: creator },
    pidsOnPort: () => [],
    kill: (pid) => killed.push(pid),
    startViewer: (args, log) => {
      started.push({ args, log });
      writeFileSync(log, "");
      return 4242;
    },
    isAlive: () => true,
    sleepMs: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, started, killed, slept };
};

describe("findViewer", () => {
  it("finds the script within 8 levels and not beyond", () => {
    const root = tmp();
    mkdirSync(join(root, "a", "b", "c", "d", "e", "f", "g"), { recursive: true });
    writeFileSync(join(root, "a", "b", "c", "d", "e", "f", "g", "generate_review.py"), "");
    expect(findViewer(root)).toBe(join(root, "a", "b", "c", "d", "e", "f", "g", "generate_review.py"));
    const deep = tmp();
    mkdirSync(join(deep, "a", "b", "c", "d", "e", "f", "g", "h"), { recursive: true });
    writeFileSync(join(deep, "a", "b", "c", "d", "e", "f", "g", "h", "generate_review.py"), "");
    expect(findViewer(deep)).toBeNull();
  });

  it("is null for a missing directory and ignores a directory of that name", () => {
    expect(findViewer("/nonexistent/skill-creator")).toBeNull();
    const root = tmp();
    mkdirSync(join(root, "generate_review.py"));
    expect(findViewer(root)).toBeNull();
  });
});

describe("main (injected effects)", () => {
  it("launches on the default port, writes the PID file, and passes the viewer args", async () => {
    const s = setup();
    const f = fakeDeps(s.creator);
    const io = fakeIo();
    expect(await main([s.iter], io.io, f.deps)).toBe(0);
    expect(io.out()).toContain("Viewer running at http://localhost:3117 (PID 4242)");
    expect(readFileSync(join(s.iter, ".viewer.pid"), "utf8")).toBe("4242\n");
    expect(f.started[0]?.args).toEqual([join(s.creator, "eval-viewer", "generate_review.py"), s.iter, "--skill-name", "gha-ci-audit", "--port", "3117"]);
    expect(f.started[0]?.log).toBe(join(s.iter, ".viewer.log"));
    expect(f.slept).toEqual([1000]);
  });

  it("passes --benchmark only when benchmark.json exists", async () => {
    const s = setup();
    const f1 = fakeDeps(s.creator);
    await main([s.iter], fakeIo().io, f1.deps);
    expect(f1.started[0]?.args).not.toContain("--benchmark");
    writeFileSync(join(s.iter, "benchmark.json"), "{}");
    const f2 = fakeDeps(s.creator);
    await main([s.iter], fakeIo().io, f2.deps);
    expect(f2.started[0]?.args).toContain(join(s.iter, "benchmark.json"));
  });

  it("forwards --previous (absolute) and --port", async () => {
    const s = setup();
    const f = fakeDeps(s.creator);
    const io = fakeIo();
    expect(await main([s.iter, "--previous", s.prev, "--port", "4242"], io.io, f.deps)).toBe(0);
    expect(io.out()).toContain("http://localhost:4242");
    const args = f.started[0]?.args ?? [];
    expect(args.slice(-4)).toEqual(["--port", "4242", "--previous-workspace", s.prev]);
  });

  it("stops processes already on the port, then waits, before launching", async () => {
    const s = setup();
    const f = fakeDeps(s.creator, { pidsOnPort: () => [11, 22] });
    const io = fakeIo();
    expect(await main([s.iter], io.io, f.deps)).toBe(0);
    expect(io.out()).toContain("Stopping existing viewer on port 3117 (PID 11 22)");
    expect(f.killed).toEqual([11, 22]);
    expect(f.slept).toEqual([500, 1000]);
  });

  it("reports the log and exits 1 when the viewer dies at startup", async () => {
    const s = setup();
    const f = fakeDeps(s.creator, {
      isAlive: () => false,
      startViewer: (_a, log) => {
        writeFileSync(log, "viewer boom\n");
        return 4242;
      },
    });
    const io = fakeIo();
    expect(await main([s.iter], io.io, f.deps)).toBe(1);
    expect(io.err()).toContain("Viewer failed to start");
    expect(io.err()).toContain("viewer boom");
  });

  it("treats a spawn that produced no PID as a failed start", async () => {
    const s = setup();
    const f = fakeDeps(s.creator, {
      startViewer: (_a, log) => {
        writeFileSync(log, "");
        return 0;
      },
    });
    expect(await main([s.iter], fakeIo().io, f.deps)).toBe(1);
  });

  it.each([
    [[], "Usage:"],
    [["iteration-1", "--bogus"], "Unknown flag: --bogus"],
    [["iteration-1", "--port"], "requires a value"],
    [["iteration-1", "--previous"], "requires a value"],
    [["iteration-1", "--port", "abc"], "--port must be a number"],
  ])("exits 1 on bad args %j", async (argv, message) => {
    const s = setup();
    const f = fakeDeps(s.creator);
    const io = fakeIo();
    expect(await main(argv, io.io, f.deps)).toBe(1);
    expect(io.err()).toContain(message);
    expect(f.started).toEqual([]);
  });

  it("exits 1 when generate_review.py cannot be found", async () => {
    const s = setup(false);
    const io = fakeIo();
    expect(await main([s.iter], io.io, fakeDeps(s.creator).deps)).toBe(1);
    expect(io.err()).toContain("generate_review.py not found");
  });

  it("exits 1 when the iteration or previous directory does not exist", async () => {
    const s = setup();
    const f = fakeDeps(s.creator);
    expect(await main([join(s.root, "missing")], fakeIo().io, f.deps)).toBe(1);
    expect(await main([s.iter, "--previous", join(s.root, "missing")], fakeIo().io, f.deps)).toBe(1);
    expect(f.started).toEqual([]);
  });
});

describe("CLI against python3 / lsof PATH shims", () => {
  const SCRIPT = join(import.meta.dirname, "launch-viewer.ts");

  const shims = (s: ReturnType<typeof setup>, pyBody: string, lsofBody = "exit 0") => {
    const bin = join(s.root, "bin");
    mkdirSync(bin);
    for (const [name, body] of [["python3", pyBody], ["lsof", lsofBody]] as const) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    return (...args: string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: s.root,
        encoding: "utf8",
        env: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, CLAUDE_SKILL_CREATOR_DIR: s.creator },
      });
  };

  it("starts a detached viewer that outlives the launcher", () => {
    const s = setup();
    const run = shims(s, 'echo "$*" > "$(dirname "$0")/args"\nexec sleep 30');
    const r = run("iteration-1", "--previous", "iteration-0", "--port", "4999");
    try {
      expect(r.stderr).toBe("");
      expect(r.stdout).toContain("Viewer running at http://localhost:4999");
      expect(readFileSync(join(s.root, "bin", "args"), "utf8")).toContain(`--previous-workspace ${s.prev}`);
      const pid = Number(readFileSync(join(s.iter, ".viewer.pid"), "utf8"));
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      const pidFile = join(s.iter, ".viewer.pid");
      if (existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, "utf8")));
        } catch {
          // already gone
        }
      }
    }
  });

  it("detects a viewer that dies at startup (not a zombie)", () => {
    const s = setup();
    const r = shims(s, 'echo "viewer boom" >&2\nexit 1')("iteration-1");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("Viewer failed to start");
    expect(r.stderr).toContain("viewer boom");
  });
});
