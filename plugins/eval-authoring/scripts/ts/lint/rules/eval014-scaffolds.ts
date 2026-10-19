import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveCasePath } from "../../parser/index.ts";
import { fromDocs } from "../sources.ts";
import type { Problem, Rule } from "../types.ts";

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The `fixtures/bin` half is not from the docs: issue #411 claimed that
 * `evals/fixtures/bin/` is prepended to PATH, but the docs, `--help` and the
 * 2.1.277 binary do not say so, and a probe case in #450 ended with
 * `command not found`. It stays a warning and says so.
 */
const binProblem = (dir: string, where: string): readonly Problem[] =>
  isDirectory(join(dir, "fixtures", "bin"))
    ? [
        {
          message: `${where} has a fixtures/bin directory. This check is speculative: nothing in the plugin-evals docs says it is put on PATH, and a probe in #450 found it is not.`,
          fix: "Do not rely on it for commands a case needs. Create what the case needs from `context.scaffold_script` (run with --scaffold) and call it by relative path, or grade without it.",
          loc: { file: join(dir, "fixtures", "bin"), line: 1 },
          source:
            "speculative: #411 claimed fixtures/bin is prepended to PATH; the docs do not say so and #450 observed it is not",
        },
      ]
    : [];

/** Git commands that put a fix or an earlier trial into history the agent can read (#744). */
const GIT_HISTORY = /\bgit\s+(?:commit|branch|tag|checkout\s+-b|switch\s+-c)\b/;
/** File names that look like an answer key. */
const ANSWER_NAME = /(?:^|[-_.])(?:answers?|solutions?|expected|golden)(?:[-_.]|$)/i;

/** Answer-looking file or `.git` entries under `dir`, at most four levels deep. */
const leakedEntries = (dir: string, depth = 0): readonly string[] => {
  if (depth > 4) return [];
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.name === ".git" || ANSWER_NAME.test(e.name)
        ? [e.name]
        : e.isDirectory()
          ? leakedEntries(join(dir, e.name), depth + 1).map((n) => `${e.name}/${n}`)
          : [],
    );
  } catch {
    return [];
  }
};

/** Leakage checks (#744): the agent can read git history and `add_dirs`. */
const leakProblems = (
  c: Parameters<NonNullable<Rule["checkCase"]>>[0],
  pluginRoot: string,
): readonly Problem[] => {
  const source = "from #744: an agent can read git history and add_dirs; Anthropic's agent-evals post reports an agent using git history of earlier trials";
  const script = c.scaffoldScript.value;
  const found = script === undefined ? undefined : resolveCasePath(c.dir, script, pluginRoot);
  const text = found?.exists ? readFileSync(found.resolved, "utf8") : "";
  const history: readonly Problem[] =
    script !== undefined && GIT_HISTORY.test(text)
      ? [
          {
            message: `Case '${c.name.value}' scaffold_script '${script}' commits, branches or tags in git, so the agent can read that history; if it holds a fix or an answer file the case leaks it.`,
            fix: "Keep the answer out of the workspace and out of git history: commit only the broken starting state, or drop the git setup.",
            loc: c.scaffoldScript.loc,
            source,
          },
        ]
      : [];
  const dirs: readonly Problem[] = c.addDirs.value.flatMap((d) => {
    const hits = leakedEntries(resolveCasePath(c.dir, d, pluginRoot).resolved);
    return hits.length === 0
      ? []
      : [
          {
            message: `Case '${c.name.value}' add_dirs entry '${d}' contains ${hits.join(", ")}, which looks like an answer key or git history the agent can read.`,
            fix: "Move the answer or the .git directory out of the directory listed in add_dirs.",
            loc: c.addDirs.loc,
            source,
          },
        ];
  });
  return [...history, ...dirs];
};

/**
 * EVAL014: scaffold script and `fixtures/bin`. `scaffold_script` is a
 * `context:` key of case.yaml only, so only case.yaml cases can fire the first
 * check; `fixtures/bin` is checked for both layouts, beside the case and at the
 * eval directory.
 */
export const rule: Rule = {
  id: "EVAL014",
  severity: "warn",
  title:
    "scaffold_script file missing, a fixtures/bin directory present (speculative), or answer leakage via scaffold git history or add_dirs",
  source: fromDocs(
    "context.scaffold_script is a Bash script in the case directory, run in the empty workspace with --scaffold; a missing file fails that run",
  ),
  checkCase: (c, { pluginRoot }) => {
    const script = c.scaffoldScript.value;
    const scaffold: readonly Problem[] =
      script === undefined
        ? []
        : resolveCasePath(c.dir, script, pluginRoot).exists
          ? []
          : [
              {
                message: `Case '${c.name.value}' sets context.scaffold_script to '${script}', but no such file exists relative to the case directory.`,
                fix: `Create ${script} in the case directory, or correct the path. A missing script fails the run with 'scaffold failed' (and it only runs with --scaffold).`,
                loc: c.scaffoldScript.loc,
              },
            ];
    return [
      ...scaffold,
      ...binProblem(c.dir, `Case '${c.name.value}'`),
      ...leakProblems(c, pluginRoot),
    ];
  },
  checkSuite: ({ suite }) => binProblem(suite.evalDir, "The eval directory"),
};
