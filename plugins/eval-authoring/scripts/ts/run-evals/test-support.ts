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
  /** The fake clock, as an ISO string. */
  readonly now?: string;
  /** Result per command; the CLI run is the `plugin` subcommand. */
  readonly claudeVersion?: string;
  readonly cliResult?: SpawnResult;
  /**
   * Per-invocation reply, given the argv and a 1-based call count. `result`
   * is written as aggregate-result.json into the invocation's `--output-dir`
   * (or into `resultSubdir` under it), as the CLI would; omit it for no file.
   */
  readonly onCli?: (
    args: readonly string[],
    n: number,
  ) => { readonly spawn?: SpawnResult; readonly result?: string; readonly resultSubdir?: string };
  readonly onPath?: Readonly<Record<string, readonly string[]>>;
  readonly files?: Readonly<Record<string, string>>;
  /** Directory listings to return, by path. */
  readonly dirs?: Readonly<Record<string, readonly string[]>>;
  /** The answer to a confirm() question; default is no. */
  readonly confirm?: boolean;
  /** Reply for a spawned `gh` call, given its argv. */
  readonly onGh?: (args: readonly string[]) => SpawnResult;
}

export interface FakeIo {
  readonly io: Io;
  readonly calls: Call[];
  readonly out: string[];
  readonly err: string[];
  readonly written: Map<string, string>;
  readonly questions: string[];
}

export const fakeIo = (o: FakeIoOptions = {}): FakeIo => {
  const calls: Call[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const written = new Map<string, string>();
  const questions: string[] = [];
  const files = new Map<string, string>(Object.entries(o.files ?? {}));
  let cliCount = 0;
  const onPath = o.onPath ?? { claude: ["/bin/claude"], git: ["/bin/git"] };
  const io: Io = {
    platform: o.platform ?? "darwin",
    cwd: o.cwd ?? "/",
    now: () => new Date(o.now ?? "2026-01-02T03:04:05.000Z"),
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    spawn: (command, args, options?: SpawnOptions) => {
      calls.push({ command, args });
      if (command === "claude" && args[0] === "--version") {
        return Promise.resolve(
          spawned({ stdout: `${o.claudeVersion ?? "2.1.287"} (Claude Code)\n` }),
        );
      }
      if (command === "gh") {
        return Promise.resolve(o.onGh?.(args) ?? spawned());
      }
      if (command === "git") {
        return Promise.resolve(spawned({ stdout: "git version 2.39.3\n" }));
      }
      cliCount += 1;
      const reply = o.onCli?.(args, cliCount);
      const dir = args[args.indexOf("--output-dir") + 1];
      if (reply?.result !== undefined && dir !== undefined) {
        files.set(
          join(dir, reply.resultSubdir ?? "", "aggregate-result.json"),
          reply.result,
        );
      }
      const r = reply?.spawn ?? o.cliResult ?? spawned();
      options?.onStdout?.(r.stdout);
      options?.onStderr?.(r.stderr);
      return Promise.resolve(r);
    },
    findOnPath: (name) => onPath[name] ?? [],
    realpath: (p) => p,
    listDir: (p) => [
      ...(o.dirs?.[p] ?? []),
      ...[...files.keys()]
        .filter((f) => f.startsWith(`${p}/`))
        .map((f) => f.slice(p.length + 1).split("/")[0] ?? "")
        .filter((e) => e !== "" && e !== "aggregate-result.json"),
    ],
    readFile: (p) => files.get(p),
    writeFile: (p, t) => {
      written.set(p, t);
    },
    confirm: (q) => {
      questions.push(q);
      return Promise.resolve(o.confirm ?? false);
    },
  };
  return { io, calls, out, err, written, questions };
};

/** Minimal valid `aggregate-result.json` text. */
export const resultJson = (over: Record<string, unknown> = {}): string =>
  resultJsonFor(["c"], over);

/** A valid result holding one passing case per name. */
export const resultJsonFor = (
  names: readonly string[],
  over: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    schemaVersion: 1,
    partial: false,
    costUsd: 0.1,
    cases: names.map((name) => ({
      name,
      aggregates: {},
      arms: { with: [{ score: 1, error: null }], without: [] },
    })),
    ...over,
  });
