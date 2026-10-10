// Launch the gha-ci-audit eval viewer (skill-creator's generate_review.py,
// which is a Python tool and stays one) in the background.
//
// Usage: node launch-viewer.ts <iteration_dir> [--previous <prev_iteration_dir>] [--port <port>]
//
// Writes <iteration_dir>/.viewer.pid and .viewer.log. Any process already
// listening on the port is stopped first.
//
// Env:
//   CLAUDE_SKILL_CREATOR_DIR  directory searched (up to 8 levels deep) for
//                             generate_review.py; default is the macOS
//                             local-agent-mode-sessions path below.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { defaultIo, type Io } from "./common.ts";

const USAGE = "Usage: launch-viewer.ts <iteration_dir> [--previous <prev_dir>] [--port <port>]\n";
const VIEWER_NAME = "generate_review.py";
const MAX_DEPTH = 8;

/** Side effects, injected so tests never start a server or kill a real process. */
export interface Deps {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** PIDs listening on a TCP port. */
  readonly pidsOnPort: (port: string) => number[];
  readonly kill: (pid: number) => void;
  /** Start the viewer detached with output going to `logPath`; returns its PID. */
  readonly startViewer: (args: string[], logPath: string) => number;
  readonly isAlive: (pid: number) => boolean;
  readonly sleepMs: (ms: number) => Promise<void>;
}

// Async on purpose: a blocking wait would stop libuv from reaping a viewer that died at
// startup, and `kill(pid, 0)` succeeds on an unreaped zombie.
const sleepMs = (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms);
  });

export const realDeps: Deps = {
  env: process.env,
  pidsOnPort: (port) => {
    const r = spawnSync("lsof", ["-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return r.stdout
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
  },
  kill: (pid) => {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  },
  startViewer: (args, logPath) => {
    const fd = openSync(logPath, "w");
    try {
      const child = spawn("python3", args, { detached: true, stdio: ["ignore", fd, fd] });
      child.unref();
      // A missing python3 surfaces as an async 'error' event; the liveness check reports it.
      child.on("error", () => undefined);
      return child.pid ?? 0;
    } finally {
      closeSync(fd);
    }
  },
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  sleepMs,
};

/** First `generate_review.py` within MAX_DEPTH levels of `root` (sorted, so deterministic). */
export const findViewer = (root: string): string | null => {
  const walk = (dir: string, depth: number): string | null => {
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return null;
    }
    for (const name of entries) {
      const p = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (!isDir && name === VIEWER_NAME) return p;
      if (isDir && depth < MAX_DEPTH) {
        const hit = walk(p, depth + 1);
        if (hit !== null) return hit;
      }
    }
    return null;
  };
  return walk(root, 1);
};

export const main = async (argv: string[], io: Io = defaultIo, deps: Deps = realDeps): Promise<number> => {
  let iterationDir = "";
  let previousDir = "";
  let port = "3117";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--previous" || a === "--port") {
      const v = argv[i + 1];
      if (v === undefined) {
        io.err(`${a} requires a value\n${USAGE}`);
        return 1;
      }
      if (a === "--previous") previousDir = v;
      else port = v;
      i++;
    } else if (a.startsWith("--")) {
      io.err(`Unknown flag: ${a}\n`);
      return 1;
    } else {
      iterationDir = a;
    }
  }
  if (iterationDir === "") {
    io.err(USAGE);
    return 1;
  }
  if (!/^\d+$/.test(port)) {
    io.err(`--port must be a number, got: ${port}\n`);
    return 1;
  }

  const creatorDir =
    deps.env["CLAUDE_SKILL_CREATOR_DIR"] ??
    join(homedir(), "Library", "Application Support", "Claude", "local-agent-mode-sessions", "skills-plugin");
  const viewer = findViewer(creatorDir);
  if (viewer === null) {
    io.err(`Error: ${VIEWER_NAME} not found under ${creatorDir}\n`);
    return 1;
  }
  const iterAbs = resolve(iterationDir);
  if (!existsSync(iterAbs)) {
    io.err(`Not found: ${iterAbs}\n`);
    return 1;
  }
  if (previousDir !== "" && !existsSync(previousDir)) {
    io.err(`Not found: ${previousDir}\n`);
    return 1;
  }

  const existing = deps.pidsOnPort(port);
  if (existing.length > 0) {
    io.out(`Stopping existing viewer on port ${port} (PID ${existing.join(" ")})...\n`);
    existing.forEach((pid) => {
      deps.kill(pid);
    });
    await deps.sleepMs(500);
  }

  const benchmark = join(iterAbs, "benchmark.json");
  const args = [
    viewer,
    iterAbs,
    "--skill-name",
    "gha-ci-audit",
    "--port",
    port,
    ...(existsSync(benchmark) ? ["--benchmark", benchmark] : []),
    ...(previousDir === "" ? [] : ["--previous-workspace", resolve(previousDir)]),
  ];
  const pidFile = join(iterAbs, ".viewer.pid");
  const logFile = join(iterAbs, ".viewer.log");
  const pid = deps.startViewer(args, logFile);
  writeFileSync(pidFile, `${String(pid)}\n`);

  await deps.sleepMs(1000);
  if (pid <= 0 || !deps.isAlive(pid)) {
    io.err(`Viewer failed to start. Log:\n${readFileSync(logFile, "utf8")}`);
    return 1;
  }
  io.out(`Viewer running at http://localhost:${port} (PID ${String(pid)})\nLog: ${logFile}\nStop: kill $(cat ${pidFile})\n`);
  return 0;
};

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
