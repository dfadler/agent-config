/**
 * `--neighbours`: load sibling plugins next to the plugin under test.
 *
 * `claude plugin eval` has no flag for this. The only route is a case's
 * `plugins:` list, and a `plugins:` entry must stay inside the plugin under
 * test (EVAL018, observed in #450, not in the docs). So the wrapper builds a
 * temp copy of the plugin, copies each neighbour into `<copy>/neighbours/<name>`,
 * and writes `plugins: [<copy>, <copy>/neighbours/<name>, ...]` into the copy
 * of each case it runs. Committed cases are never edited.
 */
import { basename, dirname, join, relative, sep } from "node:path";
import { splitFrontmatter, type EvalCase } from "../parser/index.ts";
import type { Io } from "./io.ts";

/** Where neighbours live inside the staged copy. */
export const NEIGHBOURS_DIR = "neighbours";

const NEIGHBOUR_NAME = /^[A-Za-z0-9][\w.-]*$/;

/** The `--neighbours` value as a list; undefined for an empty element, a bad name or a repeat. */
export const parseNeighbours = (text: string): readonly string[] | undefined => {
  const names = text.split(",").map((n) => n.trim());
  return names.every((n) => NEIGHBOUR_NAME.test(n)) && new Set(names).size === names.length
    ? names
    : undefined;
};

/**
 * `text` with a top-level `plugins:` line added. A `prompt.md` gets it right
 * after the opening `---` fence; a `case.yaml` gets it at the end (a column-0
 * key also closes a block scalar that ends the file). Caller checks the case
 * had no `plugins:` of its own.
 */
export const addPluginsLine = (
  text: string,
  kind: "frontmatter" | "yaml",
  entries: readonly string[],
): string => {
  const line = `plugins: ${JSON.stringify(entries)}`;
  if (kind === "yaml") return `${text.replace(/\s*$/, "")}\n${line}\n`;
  const nl = text.indexOf("\n");
  return `${text.slice(0, nl + 1)}${line}\n${text.slice(nl + 1)}`;
};

/** Which file of a case takes the line: prompt.md when it has frontmatter (it overrides case.yaml), else case.yaml. */
const targetFile = (
  c: EvalCase,
  io: Io,
): { readonly file: string; readonly kind: "frontmatter" | "yaml" } | undefined => {
  const prompt = c.promptFile === undefined ? undefined : io.readFile(c.promptFile);
  if (c.promptFile !== undefined && prompt !== undefined && splitFrontmatter(prompt).kind === "found") {
    return { file: c.promptFile, kind: "frontmatter" };
  }
  return c.caseYamlFile === undefined ? undefined : { file: c.caseYamlFile, kind: "yaml" };
};

export interface StageInput {
  /** The plugin under test (absolute). */
  readonly target: string;
  /** The `plugins/` directory the neighbours are looked up in. */
  readonly pluginsDir: string;
  /** The suite's eval directory (absolute, inside `target`). */
  readonly evalDir: string;
  readonly neighbours: readonly string[];
  /** The cases that will run; each gets the `plugins:` line. */
  readonly cases: readonly EvalCase[];
}

export type Staged =
  | {
      readonly ok: true;
      /** Remove this when done: the directory `mkTemp` returned. */
      readonly tempDir: string;
      /** The staged plugin, to pass as the CLI target. */
      readonly root: string;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * A neighbour must be a plugin that really is a direct child of `pluginsDir`
 * (symlinks resolved, so a link to a directory elsewhere is refused): only repo
 * content is copied and trusted.
 */
export const checkNeighbours = (
  io: Io,
  pluginsDir: string,
  target: string,
  neighbours: readonly string[],
): string | undefined => {
  const bad = neighbours.find(
    (n) =>
      n === basename(target) ||
      io.readFile(join(pluginsDir, n, ".claude-plugin", "plugin.json")) === undefined ||
      dirname(io.realpath(join(pluginsDir, n))) !== io.realpath(pluginsDir),
  );
  return bad === undefined
    ? undefined
    : bad === basename(target)
      ? `--neighbours: '${bad}' is the plugin under test; name its siblings`
      : `--neighbours: '${bad}' is not a plugin directly under ${pluginsDir} (needs .claude-plugin/plugin.json and no symlink out)`;
};

/**
 * Everything staging would refuse, found without writing anything, so a
 * `--dry-run` reports what the real run would: a bad neighbour, an eval dir
 * outside the plugin, a case with its own `plugins:`, a case file that cannot
 * be read.
 */
export const checkStageable = (io: Io, input: StageInput): string | undefined => {
  const { target, pluginsDir, evalDir, neighbours, cases } = input;
  const bad = checkNeighbours(io, pluginsDir, target, neighbours);
  if (bad !== undefined) return bad;
  const evalRel = relative(target, evalDir);
  if (evalRel === "" || evalRel.startsWith("..")) {
    return `--neighbours: eval dir ${evalDir} is not inside ${target}`;
  }
  const withOwn = cases.find((c) => c.plugins.explicit);
  if (withOwn !== undefined) {
    return `--neighbours: case '${withOwn.name.value}' already has its own plugins: list (${withOwn.plugins.loc.file}:${String(withOwn.plugins.loc.line)}); the wrapper only adds the line to cases without one`;
  }
  const unreadable = cases.find((c) => {
    const t = targetFile(c, io);
    return t === undefined || io.readFile(t.file) === undefined;
  });
  return unreadable === undefined
    ? undefined
    : `--neighbours: case '${unreadable.name.value}' has no readable case.yaml or prompt.md frontmatter to add plugins: to`;
};

const skipCommon = (rel: string): boolean =>
  rel.split(sep).some((p) => p === ".git" || p === "node_modules");

/**
 * Build the staged copy and rewrite its cases. Writes only under a fresh temp
 * directory, which is removed again if anything throws midway.
 */
export const stageNeighbours = (io: Io, input: StageInput): Staged => {
  const { target, pluginsDir, evalDir, neighbours, cases } = input;
  const problem = checkStageable(io, input);
  if (problem !== undefined) return { ok: false, reason: problem };
  const evalRel = relative(target, evalDir);
  const tempDir = io.mkTemp("run-evals-neighbours-");
  const root = join(tempDir, basename(target));
  try {
    io.copyDir(target, root, (rel) => skipCommon(rel) || rel === join(evalRel, "results"));
    neighbours.forEach((n) => {
      io.copyDir(
        join(pluginsDir, n),
        join(root, NEIGHBOURS_DIR, n),
        // A neighbour contributes its skills; its own evals stay behind.
        (rel) => skipCommon(rel) || rel === "evals" || rel.startsWith(`evals${sep}`),
      );
    });
    cases.forEach((c) => {
      const t = targetFile(c, io);
      const text = t === undefined ? undefined : io.readFile(t.file);
      if (t === undefined || text === undefined) {
        throw new Error(`case '${c.name.value}' lost its case file between the check and the copy`);
      }
      const caseDir = join(root, relative(target, c.dir));
      const entries = [
        relative(caseDir, root) || ".",
        ...neighbours.map((n) => relative(caseDir, join(root, NEIGHBOURS_DIR, n))),
      ];
      io.writeFile(join(root, relative(target, t.file)), addPluginsLine(text, t.kind, entries));
    });
  } catch (e: unknown) {
    io.remove(tempDir);
    throw e;
  }
  return { ok: true, tempDir, root };
};
