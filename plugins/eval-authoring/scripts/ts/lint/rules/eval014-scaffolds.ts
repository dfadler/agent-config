import { statSync } from "node:fs";
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
    "scaffold_script file missing, or a fixtures/bin directory present (speculative)",
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
    return [...scaffold, ...binProblem(c.dir, `Case '${c.name.value}'`)];
  },
  checkSuite: ({ suite }) => binProblem(suite.evalDir, "The eval directory"),
};
