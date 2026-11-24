import type { Problem, Rule } from "../types.ts";

/**
 * A file name with an extension, optionally under a directory, in the prompt. Heuristic:
 * the lint cannot read what the prompt means, so this is a name-shaped token.
 */
const FILE_NAME =
  /(?:^|[\s`'"(])(?:[\w.-]+\/)*[\w.-]+\.(?:json|ya?ml|css|scss|tsx?|jsx?|md|txt|csv|html|env|toml|py|sh)\b/;
/** Wording that asks the agent to look for something on disk. */
const SEARCH_WORDING = /\b(?:search|find|grep|look\s+up|locate)\b/i;
/** A fenced block is the usual way a prompt carries its inputs inline. */
const FENCE = /```/;

/**
 * EVAL033: a prompt that depends on an empty workspace. Each run starts in an empty
 * working directory (plugin-evals docs, "Write a case manually"), and only `Read` is
 * granted by default. A prompt that names a file with no inline content and no
 * scaffold, history or add_dirs, or that asks to search while `allowed_tools` lacks
 * `Glob` or `Grep`, sends the model looking for files that are not there.
 */
export const rule: Rule = {
  id: "EVAL033",
  severity: "warn",
  // Opt-in at first: the checks are name-shaped, so a healthy suite may hit false positives. Turn on with `--enable EVAL033`.
  optIn: true,
  title:
    "prompt names a file or asks to search with no inline content, workspace setup, or Glob/Grep granted (the workspace is empty at run time)",
  source:
    "from the plugin-evals docs: 'Each run starts in an empty working directory, so put whatever the task needs in the prompt itself, or set up the workspace first.' and 'A run allows only the read-only tools the case lists in allowed_tools'",
  checkCase: (c) => {
    const prompt = c.prompt.value ?? "";
    const tools = new Set(c.allowedTools.value.map((t) => t.tool));
    const hasWorkspace =
      c.scaffoldScript.value !== undefined ||
      c.historyFile.value !== undefined ||
      c.addDirs.value.length > 0;
    const problems: Problem[] = [];
    if (!hasWorkspace && FILE_NAME.test(prompt) && !FENCE.test(prompt)) {
      problems.push({
        message: `Case '${c.name.value}' names a file in its prompt, but the run starts in an empty workspace and the case sets no scaffold_script, history_file or add_dirs, so the file does not exist for the run.`,
        fix: "Put the file's content inline in the prompt (in a fenced block), or set up the workspace with context.scaffold_script, history_file or add_dirs.",
        loc: c.prompt.loc,
      });
    }
    if (SEARCH_WORDING.test(prompt) && !(tools.has("Glob") || tools.has("Grep"))) {
      problems.push({
        message: `Case '${c.name.value}' asks the agent to search, find or grep, but allowed_tools lacks Glob and Grep, so those tools are removed from the run.`,
        fix: "Add Glob or Grep to execution.allowed_tools if the search is the point, or reword the prompt to supply the inputs inline.",
        loc: c.prompt.loc,
      });
    }
    return problems;
  },
};
