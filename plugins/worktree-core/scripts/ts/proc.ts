// Tiny process runner shared by the worktree-core scripts. Argv arrays only,
// never a shell. Standalone: node builtins only.
import { spawnSync } from "node:child_process";

export interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run `cmd args` in `cwd`; a missing executable is status 127. */
export type Run = (
  cmd: string,
  args: readonly string[],
  cwd: string,
) => RunResult;

export type Env = Readonly<Record<string, string | undefined>>;

export const makeRun =
  (env: Env): Run =>
  (cmd, args, cwd) => {
    const r = spawnSync(cmd, [...args], {
      cwd,
      env,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return {
      status: r.status ?? (r.error ? 127 : 1),
      stdout: r.stdout,
      stderr: r.stderr,
    };
  };
