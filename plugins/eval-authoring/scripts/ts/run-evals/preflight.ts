/**
 * Preflight checks, run before any paid call. Each check is a small pure
 * function over a probe result; `runPreflight` gathers the probes.
 */
import { EXIT_DEPENDENCY, type ExitCode } from "./exit-codes.ts";
import type { Io, SpawnResult } from "./io.ts";
import {
  MIN_CLAUDE_VERSION,
  MIN_GIT_VERSION,
  atLeast,
  formatVersion,
  parseVersion,
  type Version,
} from "./versions.ts";

export interface Finding {
  readonly level: "error" | "warning";
  readonly message: string;
  /** The exit code an error maps to. Warnings never fail the run. */
  readonly code: ExitCode;
}

const error = (message: string): Finding => ({
  level: "error",
  message,
  code: EXIT_DEPENDENCY,
});
const warning = (message: string): Finding => ({
  level: "warning",
  message,
  code: EXIT_DEPENDENCY,
});

const versionFinding = (
  what: string,
  probe: SpawnResult,
  min: Version,
): readonly Finding[] => {
  const v = parseVersion(probe.stdout);
  return v === undefined
    ? [error(`could not read the ${what} version from '${probe.stdout.trim()}'`)]
    : atLeast(v, min)
      ? []
      : [
          error(
            `${what} ${formatVersion(v)} is too old: plugin evals need ${formatVersion(min)} or later`,
          ),
        ];
};

/** Claude Code 2.1.269 or later. `probe` is the result of `claude --version`; undefined when claude is not on PATH. */
export const checkClaudeVersion = (
  probe: SpawnResult | undefined,
): readonly Finding[] =>
  probe === undefined || probe.error !== undefined || probe.status !== 0
    ? [error("could not run 'claude --version': is Claude Code installed and on PATH?")]
    : versionFinding("Claude Code", probe, MIN_CLAUDE_VERSION);

/** git 2.31 or later, only if git is installed: without git the CLI runs normally. */
export const checkGitVersion = (
  probe: SpawnResult | undefined,
): readonly Finding[] =>
  probe === undefined || probe.error !== undefined || probe.status !== 0
    ? []
    : versionFinding("git", probe, MIN_GIT_VERSION);

/** Linux needs bubblewrap (`bwrap`) and `socat`; native Windows has no backend; macOS is built in. */
export const checkSandbox = (
  platform: string,
  grantsBash: boolean,
  onPath: (name: string) => boolean,
): readonly Finding[] => {
  if (!grantsBash) return [];
  if (platform === "win32") {
    return [
      error(
        "Bash is granted but native Windows has no OS sandbox backend; run under WSL or drop the Bash grant",
      ),
    ];
  }
  if (platform !== "linux") return [];
  const missing = [
    ["bubblewrap", "bwrap"],
    ["socat", "socat"],
  ].filter(([, bin]) => !onPath(bin ?? ""));
  return missing.length === 0
    ? []
    : [
        error(
          `Bash is granted but the sandbox backend is incomplete on Linux; install ${missing.map(([pkg]) => pkg).join(" and ")}`,
        ),
      ];
};

/** More than one distinct `claude` on PATH: the one that runs may not be the one you updated. */
export const checkShadowing = (installs: readonly string[]): readonly Finding[] =>
  installs.length > 1
    ? [
        warning(
          `more than one claude install on PATH (the first one runs): ${installs.join(", ")}`,
        ),
      ]
    : [];

/** Run every check. `grantsBash` is true when any run group is granted Bash. */
export const runPreflight = async (
  io: Io,
  grantsBash: boolean,
): Promise<readonly Finding[]> => {
  const claudes = io.findOnPath("claude");
  if (claudes.length === 0) {
    return [error("'claude' is not on PATH")];
  }
  const claude = await io.spawn("claude", ["--version"]);
  const git =
    io.findOnPath("git").length === 0
      ? undefined
      : await io.spawn("git", ["--version"]);
  return [
    ...checkClaudeVersion(claude),
    ...checkGitVersion(git),
    ...checkSandbox(
      io.platform,
      grantsBash,
      (name) => io.findOnPath(name).length > 0,
    ),
    ...checkShadowing(claudes),
  ];
};
