/**
 * The wrapper's only contact with the outside world. Everything else takes an
 * `Io`, so tests inject a fake and never spawn the real CLI.
 */
import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

export interface SpawnOptions {
  /** Called with each stdout chunk as it arrives, so output can be shown live and still captured. */
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
}

export interface SpawnResult {
  /** Exit status; null when the process died on a signal or never started. */
  readonly status: number | null;
  /** The terminating signal, if any. */
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when the process could not be started (for example ENOENT). */
  readonly error: string | undefined;
}

/** Runs a process. The real one is `spawnProcess`; tests pass a fake. */
export type Spawner = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => Promise<SpawnResult>;

export interface Io {
  readonly platform: string;
  readonly cwd: string;
  /** The current time; injected so tests can fix the run directory name. */
  readonly now: () => Date;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly spawn: Spawner;
  /** Every executable called `name` on PATH, resolved through symlinks, de-duplicated, in PATH order. */
  readonly findOnPath: (name: string) => readonly string[];
  readonly realpath: (path: string) => string;
  /** Entry names in a directory; empty when it does not exist. */
  readonly listDir: (path: string) => readonly string[];
  /** File contents, or undefined when unreadable. */
  readonly readFile: (path: string) => string | undefined;
  /** Writes a file, creating parent directories. */
  readonly writeFile: (path: string, text: string) => void;
  /** Asks a yes/no question on the terminal. False (never a guess) when there is no one to ask. */
  readonly confirm: (question: string) => Promise<boolean>;
}

export const spawnProcess: Spawner = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["inherit", "pipe", "pipe"],
    });
    const chunks = { stdout: "", stderr: "" };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d: string) => {
      chunks.stdout += d;
      options.onStdout?.(d);
    });
    child.stderr.on("data", (d: string) => {
      chunks.stderr += d;
      options.onStderr?.(d);
    });
    child.on("error", (e) => {
      resolve({
        status: null,
        signal: null,
        stdout: chunks.stdout,
        stderr: chunks.stderr,
        error: e.message,
      });
    });
    child.on("close", (status, signal) => {
      resolve({
        status,
        signal,
        stdout: chunks.stdout,
        stderr: chunks.stderr,
        error: undefined,
      });
    });
  });

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** `which -a`: all matches on `pathVar`, resolved and de-duplicated. */
export const findExecutables = (
  name: string,
  pathVar: string,
  platform: string,
  executable: (path: string) => boolean = isExecutable,
): readonly string[] => {
  const suffixes = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const found = pathVar
    .split(platform === "win32" ? ";" : delimiter)
    .filter((d) => d !== "")
    .flatMap((d) => suffixes.map((s) => join(d, name + s)))
    .filter(executable)
    .map(real);
  return [...new Set(found)];
};

export const nodeIo = (env: Readonly<Record<string, string | undefined>>): Io => ({
  platform: process.platform,
  cwd: process.cwd(),
  now: () => new Date(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  spawn: spawnProcess,
  findOnPath: (name) =>
    findExecutables(name, env["PATH"] ?? "", process.platform),
  realpath: real,
  listDir: (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  readFile: (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  writeFile: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  },
  confirm: async (question) => {
    if (!process.stdin.isTTY) return false;
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question(question);
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
  },
});
