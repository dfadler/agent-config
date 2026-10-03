/**
 * Lint CLI (#453): `node cli.ts [options] [PLUGIN_ROOT]`. `main` is a pure
 * function of argv (plus the files it lints); the entrypoint at the bottom is
 * the only code that writes output and exits. Self-contained: a plugin ships on
 * its own, so this does not import the repo's `scripts/ts/lib/` (docs/testing.md).
 * Rules are injected so tests can run it with any rule set.
 */
import { statSync, writeSync } from "node:fs";
import { discoverRules } from "./discover.ts";
import {
  EXIT_CONFIG,
  EXIT_FAILURE,
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_USAGE,
  type ExitCode,
} from "./exit-codes.ts";
import {
  countSeverity,
  formatJson,
  formatText,
  lintPlugin,
  type LintOptions,
} from "./runner.ts";
import type { Rule } from "./types.ts";

export const USAGE = `Usage: cli.ts [-h|--help] [--eval-dir DIR] [--grants FILE] [--format text|json] [--list-rules] [PLUGIN_ROOT]

Lint the eval cases of a plugin against the grader-stability rules. Free: no
model calls, no network. PLUGIN_ROOT defaults to the current directory.

Options:
  --eval-dir DIR   Eval directory, relative to PLUGIN_ROOT. Default: the
                   manifest's experimental.evals, else evals.
  --grants FILE    Grants file. Default: <eval dir>/grants.yaml.
  --format FORMAT  text (default) or json.
  --list-rules     Print every rule's ID, severity and title, then exit.
  -h, --help       Print this help.

Output (text): a header naming the Claude Code version the schema was written
against, then one block per finding, sorted by file and line:

  FILE:LINE:COL: SEVERITY RULE_ID: what is wrong
      Fix: what to change
      Source: the docs section, or "from #411" where the docs do not say

then a summary line. Severities: error (fails the run), warn, info. A file the
parser cannot read is reported as PARSE (error). --format json prints the same
findings as JSON ({ claudeCodeVersion, counts, findings: [...] }).

Exit codes (same taxonomy as the repo's shell scripts):
  0   no errors (warnings and info are reported only)
  1   at least one error finding
  2   bad arguments, or PLUGIN_ROOT or --eval-dir is not usable
  3   the plugin manifest's experimental.evals is not a usable path
  20  internal error (a rule threw, or the rules failed to load)
`;

/** What the entrypoint prints and exits with. */
export interface CliResult {
  readonly code: ExitCode;
  readonly stdout: string;
  readonly stderr: string;
}

const done = (code: ExitCode, stdout: string, stderr = ""): CliResult => ({
  code,
  stdout,
  stderr,
});
const usageError = (problem: string): CliResult =>
  done(EXIT_USAGE, "", `${problem}\n\n${USAGE}`);

interface Args {
  readonly evalDir: string | undefined;
  readonly grants: string | undefined;
  readonly format: string;
  readonly listRules: boolean;
  readonly positionals: readonly string[];
}

const VALUED = new Set(["--eval-dir", "--grants", "--format"]);

/** Parse argv. `help` wins over everything else; a bad flag is a usage error. */
const parse = (
  argv: readonly string[],
): Args | "help" | { readonly error: string } => {
  const dashes = argv.indexOf("--");
  const flagArgs = dashes === -1 ? argv : argv.slice(0, dashes);
  if (flagArgs.some((a) => a === "-h" || a === "--help")) return "help";
  const values = new Map<string, string>();
  const positionals: string[] = [];
  let listRules = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    const eq = arg.indexOf("=");
    const key = arg.startsWith("--") && eq !== -1 ? arg.slice(0, eq) : arg;
    if (key === "--list-rules" && key === arg) {
      listRules = true;
    } else if (VALUED.has(key)) {
      const inline = key === arg ? undefined : arg.slice(eq + 1);
      const value = inline ?? argv[i + 1];
      if (value === undefined) return { error: `option ${key} requires a value` };
      values.set(key, value);
      if (inline === undefined) i += 1;
    } else if (arg.startsWith("-") && arg !== "-") {
      return { error: `unknown option: ${key}` };
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    return { error: `expected at most 1 argument, got ${String(positionals.length)}` };
  }
  return {
    evalDir: values.get("--eval-dir"),
    grants: values.get("--grants"),
    format: values.get("--format") ?? "text",
    listRules,
    positionals,
  };
};

const listRulesText = (rules: readonly Rule[]): string =>
  `${rules.map((r) => `${r.id}  ${r.severity.padEnd(5)}  ${r.title}`).join("\n")}\n`;

const isDirectory = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The command: argv and a rule set in, exit code and output out. */
export const main = (
  argv: readonly string[],
  rules: readonly Rule[],
): CliResult => {
  const args = parse(argv);
  if (args === "help") return done(EXIT_OK, USAGE);
  if ("error" in args) return usageError(args.error);
  if (args.listRules) return done(EXIT_OK, listRulesText(rules));
  if (args.format !== "text" && args.format !== "json") {
    return usageError("--format must be text or json");
  }
  const pluginRoot = args.positionals[0] ?? ".";
  if (!isDirectory(pluginRoot)) {
    return done(EXIT_USAGE, "", `not a directory: ${pluginRoot}\n`);
  }
  const options: LintOptions = {
    ...(args.evalDir === undefined ? {} : { evalDir: args.evalDir }),
    ...(args.grants === undefined ? {} : { grantsFile: args.grants }),
  };
  const outcome = lintPlugin(pluginRoot, rules, options);
  if (!outcome.ok) {
    return done(
      outcome.source === "flag" ? EXIT_USAGE : EXIT_CONFIG,
      "",
      `${outcome.reason}\n`,
    );
  }
  const text =
    args.format === "json"
      ? formatJson(outcome.report)
      : formatText(outcome.report);
  return countSeverity(outcome.report, "error") > 0
    ? done(EXIT_FAILURE, text) // the report is stdout either way; the hook reads it there
    : done(EXIT_OK, text);
};

/** Run `main` against the real rules; a rule that throws or fails to load is `EXIT_INTERNAL`. */
export const mainWithDiscoveredRules = async (
  argv: readonly string[],
): Promise<CliResult> => {
  const found = await discoverRules();
  if (!found.ok) return done(EXIT_INTERNAL, "", `${found.message}\n`);
  try {
    return main(argv, found.rules);
  } catch (e) {
    return done(
      EXIT_INTERNAL,
      "",
      `internal error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
  }
};

if (import.meta.main) {
  const result = await mainWithDiscoveredRules(process.argv.slice(2));
  writeSync(1, result.stdout);
  writeSync(2, result.stderr);
  process.exit(result.code);
}
