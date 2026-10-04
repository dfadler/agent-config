/** Helpers shared by the wrapper's tests: a throwaway plugin on disk and a fake `Io`. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Io, SpawnOptions, SpawnResult } from "./io.ts";

export interface FakeCase {
  readonly name: string;
  readonly tags?: readonly string[];
}

/** Write a plugin with the given cases (and optional grants.yaml); returns its root. */
export const makePlugin = (
  cases: readonly FakeCase[],
  grantsYaml?: string,
): string => {
  const root = mkdtempSync(join(tmpdir(), "run-evals-"));
  cases.forEach((c) => {
    const dir = join(root, "evals", c.name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "case.yaml"),
      [
        'schema_version: "1.1"',
        `name: ${c.name}`,
        `tags: [${(c.tags ?? []).join(", ")}]`,
        "execution:",
        "  prompt: hello",
        "graders:",
        "  - name: g",
        "    type: regex",
        "    target: last_message",
        "    pattern: hi",
        "    match: contains",
        "",
      ].join("\n"),
    );
  });
  if (grantsYaml !== undefined) {
    writeFileSync(join(root, "evals", "grants.yaml"), grantsYaml);
  }
  return root;
};

export const spawned = (
  over: Partial<SpawnResult> = {},
): SpawnResult => ({
  status: 0,
  signal: null,
  stdout: "",
  stderr: "",
  error: undefined,
  ...over,
});

export interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

export interface FakeIoOptions {
  readonly platform?: string;
  readonly cwd?: string;
  /** Result per command; the CLI run is the `plugin` subcommand. */
  readonly claudeVersion?: string;
  readonly cliResult?: SpawnResult;
  readonly onPath?: Readonly<Record<string, readonly string[]>>;
  readonly files?: Readonly<Record<string, string>>;
  /** Directory listings to return, by path. */
  readonly dirs?: Readonly<Record<string, readonly string[]>>;
}

export interface FakeIo {
  readonly io: Io;
  readonly calls: Call[];
  readonly out: string[];
  readonly err: string[];
  readonly written: Map<string, string>;
}

export const fakeIo = (o: FakeIoOptions = {}): FakeIo => {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const onPath = o.onPath ?? { claude: ["/bin/claude"], git: ["/bin/git"] };
  const io: Io = {
    platform: o.platform ?? "darwin",
    cwd: o.cwd ?? "/",
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    spawn: (command, args, options?: SpawnOptions) => {
      calls.push({ command, args });
      if (command === "claude" && args[0] === "--version") {
        return Promise.resolve(
          spawned({ stdout: `${o.claudeVersion ?? "2.1.287"} (Claude Code)\n` }),
        );
      }
      if (command === "git") {
        return Promise.resolve(spawned({ stdout: "git version 2.39.3\n" }));
      }
      const r = o.cliResult ?? spawned();
      options?.onStdout?.(r.stdout);
      options?.onStderr?.(r.stderr);
      return Promise.resolve(r);
    },
    findOnPath: (name) => onPath[name] ?? [],
    realpath: (p) => p,
    listDir: (p) => o.dirs?.[p] ?? [],
    readFile: (p) => o.files?.[p],
    writeFile: (p, t) => {
      written.set(p, t);
    },
  };
  return { io, calls, out, err, written };
};

/** Minimal valid `aggregate-result.json` text. */
export const resultJson = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    partial: false,
    cases: [
      {
        name: "c",
        aggregates: {},
        arms: { with: [{ score: 1, error: null }], without: [] },
      },
    ],
    ...over,
  });
