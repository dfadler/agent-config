// Verify relative Markdown links -- [text](./path/to/file.md) -- resolve to a
// real file (or directory) on disk.
//
// A link target is resolved two ways, in order:
//   1. relative to the linking file's own directory
//   2. relative to the repo root
// Only failing both is reported as broken. The fallback means a link written
// as if from repo root (including a leading-slash link, since dir//foo and
// root//foo both collapse to a single slash) isn't flagged just for not being
// relative to its own file.
//
// This is a regex scan, not a Markdown parser: it does not know about fenced
// code blocks, so a `[text](path)`-shaped example inside a fence is checked
// like a real link. Inline code spans (single backticks) ARE stripped first,
// per line, since the docs use `[alt](url)`-shaped snippets inline.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs, type Parsed } from "./lib/args.ts";
import {
  cliError,
  EXIT_FAILURE,
  EXIT_USAGE,
  type CliError,
} from "./lib/exit-codes.ts";
import { pipe } from "./lib/pipe.ts";
import { andThen, collect, err, map, ok, type Result } from "./lib/result.ts";
import { run, type Effects, type Env, type Main } from "./lib/run.ts";

export const USAGE = `Usage: check-markdown-links.ts [--path <file-or-dir>]

Scans Markdown files under <path> (default: .) for [text](path) links and
verifies every relative link target resolves to a real file or directory on
disk.

Options:
  --path <path>   File or directory to scan (default: .)
  -h, --help      Show this help and exit

Skipped (not checked):
  - http:// and https:// links
  - mailto: links
  - anchor-only links (#foo)

Exit status:
  0   every relative link resolved
  1   at least one broken link was found
  2   usage error (bad flag, or --path does not exist)
`;

/** A Markdown file to scan. `dir` is the absolute directory of `path`. */
export interface LinkFile {
  readonly path: string;
  readonly dir: string;
  readonly text: string;
}

/** A relative link found in a file: 1-based line and the target, anchor stripped. */
export interface Link {
  readonly line: number;
  readonly target: string;
}

const EXTERNAL = /^(https?:\/\/|mailto:)/;

/** The target of a matched `[text](target)`: after the LAST `](`, minus the `)`. */
const targetOf = (match: string): string =>
  match.slice(match.lastIndexOf("](") + 2, -1);

/**
 * Pure: every checkable relative link in `text`. Skips inline code spans,
 * http(s)/mailto links and anchor-only links; strips a `#anchor` suffix.
 */
export const extractLinks = (text: string): readonly Link[] =>
  text.split("\n").flatMap((rawLine, i): readonly Link[] =>
    [...rawLine.replace(/`[^`]*`/g, "").matchAll(/\[[^\]]*\]\([^)]+\)/g)].flatMap(
      (m): readonly Link[] => {
        const target = targetOf(m[0]).split("#")[0] ?? "";
        return target === "" || EXTERNAL.test(target)
          ? []
          : [{ line: i + 1, target }];
      },
    ),
  );

/**
 * Pure apart from the injected `exists`: one message per broken link, in file
 * then line order. Resolution is per link, never dependent on other files.
 */
export const findBrokenLinks = (
  files: readonly LinkFile[],
  exists: (path: string) => boolean,
  repoRoot: string,
): readonly string[] =>
  files.flatMap((f) =>
    extractLinks(f.text)
      .filter(
        (l) =>
          !exists(`${f.dir}/${l.target}`) && !exists(`${repoRoot}/${l.target}`),
      )
      .map((l) => `${f.path}:${String(l.line)}: broken link -> ${l.target}`),
  );

/** Pure: the report for a set of broken-link messages. */
export const report = (
  broken: readonly string[],
  scanned: number,
): Result<CliError, string> =>
  broken.length > 0
    ? err(
        cliError(
          EXIT_FAILURE,
          `::error::Broken relative markdown links:\n${broken.map((b) => `  ${b}`).join("\n")}`,
        ),
      )
    : ok(
        `✓ All relative markdown links resolve (${String(scanned)} files scanned).\n`,
      );

/** The filesystem and git facts a scan needs; injected so `main` is testable. */
export interface LinkDeps {
  readonly exists: (path: string) => boolean;
  /** `undefined` if `path` does not exist; otherwise whether it is a directory. */
  readonly isDirectory: (path: string) => boolean | undefined;
  /** Markdown files under a directory, `.git`/`node_modules` pruned. Paths are `dir/rel`. */
  readonly listMarkdown: (dir: string) => readonly string[];
  /** The repo root containing `dir` (git toplevel, else `dir` itself). */
  readonly repoRoot: (dir: string) => string;
}

const SKIPPED_DIRS: ReadonlySet<string> = new Set([".git", "node_modules"]);

/** Recursive, sorted for stable output; a symlink is not followed or listed. */
export const walk = (dir: string): readonly string[] =>
  readdirSync(dir, { withFileTypes: true })
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .flatMap((e): readonly string[] => {
      if (e.isDirectory()) {
        return SKIPPED_DIRS.has(e.name) ? [] : walk(`${dir}/${e.name}`);
      }
      return e.isFile() && e.name.endsWith(".md") ? [`${dir}/${e.name}`] : [];
    });

/** Real filesystem and git. */
export const nodeLinkDeps: LinkDeps = {
  exists: existsSync,
  isDirectory: (path) =>
    existsSync(path) ? statSync(path).isDirectory() : undefined,
  listMarkdown: walk,
  repoRoot: (dir) => {
    const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
    });
    return git.status === 0 ? git.stdout.trim() : resolve(dir);
  },
};

const readAll = (
  paths: readonly string[],
  readFile: Effects["readFile"],
): Result<CliError, readonly LinkFile[]> =>
  collect(
    paths.map((path) =>
      pipe(
        readFile(path),
        map(
          (text: string): LinkFile => ({
            path,
            dir: resolve(dirname(path)),
            text,
          }),
        ),
      ),
    ),
  );

const scan = (
  target: string,
  deps: LinkDeps,
  readFile: Effects["readFile"],
): Result<CliError, string> => {
  const isDir = deps.isDirectory(target);
  if (isDir === undefined) {
    return err(cliError(EXIT_USAGE, `path not found: ${target}`));
  }
  if (!isDir && !target.endsWith(".md")) {
    return err(cliError(EXIT_USAGE, `not a markdown file: ${target}`));
  }
  const paths = isDir ? deps.listMarkdown(target) : [target];
  const root = deps.repoRoot(isDir ? target : dirname(target));
  return pipe(
    readAll(paths, readFile),
    map((files: readonly LinkFile[]) =>
      report(findBrokenLinks(files, deps.exists, root), files.length),
    ),
    andThen((r: Result<CliError, string>) => r),
  );
};

/** Build a `main` over injected filesystem facts. */
export const makeMain =
  (deps: LinkDeps): Main =>
  (argv: readonly string[], _env: Env, io) =>
    pipe(
      parseArgs(
        {
          usage: USAGE,
          flags: [{ name: "path", valued: true }],
          maxPositionals: 0,
        },
        argv,
      ),
      andThen((parsed: Parsed) => {
        if (parsed.kind === "help") return ok(parsed.usage);
        const path = parsed.flags["path"];
        return scan(typeof path === "string" ? path : ".", deps, io.readFile);
      }),
    );

export const main: Main = makeMain(nodeLinkDeps);

if (import.meta.main) run(main);
