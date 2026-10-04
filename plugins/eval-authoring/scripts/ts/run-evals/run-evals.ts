/**
 * run-evals: a cost-tier wrapper around the plugin-eval CLI. Callers pick a
 * tier; the wrapper hides the flags, passes each case group's recorded grants,
 * checks the preconditions, and turns the run into one named exit code.
 *
 * Usage: see USAGE below, or run with --help.
 */
import { basename, dirname, join, resolve } from "node:path";
import { readGrantsFile, readSuite } from "../parser/index.ts";
import { buildCliArgs, type Reporting, type RunSpec } from "./command.ts";
import {
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_USAGE,
  worstExit,
  type ExitCode,
} from "./exit-codes.ts";
import { nodeIo, type Io } from "./io.ts";
import {
  AGGREGATE_FILE,
  candidateResultDirs,
  findingsFromText,
  judgeRun,
  type Judgement,
} from "./outcome.ts";
import { scanOutput } from "./output.ts";
import { needsBash, planGroups, type RunGroup } from "./plan.ts";
import { runPreflight } from "./preflight.ts";
import {
  DEFAULT_TIER,
  TIERS,
  isTierName,
  type AblationMode,
  type Tier,
} from "./tiers.ts";

export const USAGE = `Usage: run-evals.ts [options] <plugin-path>

Run a plugin's eval cases at a cost tier. Cases with identical grants
(<eval-dir>/grants.yaml) share one run; each group runs under exactly its own
grants. Never passes --scaffold.

Options:
  --tier <name>        quick | standard | thorough (default: ${DEFAULT_TIER})
${Object.values(TIERS).map((t) => `                         ${t.name}: ${t.description}`).join("\n")}
  --model <id>         pin the model (default: pinned in the wrapper)
  --judge-model <id>   pin the judge model (default: pinned in the wrapper)
  --eval-dir <dir>     eval directory relative to the plugin
  --json-file <path>   write the CLI's JSON result to a file
  --report <path>      write the HTML report to a path
  --output-dir <dir>   results directory (each group gets <dir>/group-N)
  --publish-report     publish the report (default: --no-publish)
  --keep-temp          keep run traces
  --skip-unavailable   exit 0 when plugin eval is in early access or down
  --dry-run            print the commands and exit; runs nothing
  -h, --help           show this help

Exit codes:
  0   every group passed, results trustworthy
  1   below threshold, load failure, no cases, untrusted directory, invalid option
  2   wrapper usage error
  3   bad cases or grants file, or the CLI says a case cannot pass with its grants
  4   unmet requirement (Claude Code < 2.1.269, git < 2.31, sandbox backend,
      claude missing, or plugin eval unavailable)
  7   partial or untrustworthy run (cost ceiling, rejected credential, a run
      errored, paid graders skipped)
  20  internal error
  130 interrupted
  143 terminated
`;

interface Options {
  readonly plugin: string;
  readonly tier: Tier;
  readonly model: string | undefined;
  readonly judgeModel: string | undefined;
  readonly evalDir: string | undefined;
  readonly reporting: Reporting;
  readonly skipUnavailable: boolean;
  readonly dryRun: boolean;
}

type Parsed =
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "options"; readonly options: Options };

const VALUE_FLAGS: readonly string[] = [
  "--tier",
  "--model",
  "--judge-model",
  "--eval-dir",
  "--json-file",
  "--report",
  "--output-dir",
];
const BOOL_FLAGS: readonly string[] = [
  "--publish-report",
  "--keep-temp",
  "--skip-unavailable",
  "--dry-run",
];

/** Parse argv. `-h`/`--help` anywhere wins before anything else is validated. */
export const parseArgs = (argv: readonly string[]): Parsed => {
  if (argv.includes("-h") || argv.includes("--help")) return { kind: "help" };
  const values = new Map<string, string>();
  const bools = new Set<string>();
  const positionals: string[] = [];
  const bad = ((): string | undefined => {
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i] ?? "";
      if (VALUE_FLAGS.includes(a)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith("--")) return `${a} needs a value`;
        values.set(a, v);
        i += 1;
      } else if (BOOL_FLAGS.includes(a)) {
        bools.add(a);
      } else if (a.startsWith("-")) {
        return `unknown option '${a}'`;
      } else {
        positionals.push(a);
      }
    }
    return undefined;
  })();
  if (bad !== undefined) return { kind: "error", message: bad };
  const tierName = values.get("--tier") ?? DEFAULT_TIER;
  if (!isTierName(tierName)) {
    return {
      kind: "error",
      message: `unknown tier '${tierName}' (expected ${Object.keys(TIERS).join(", ")})`,
    };
  }
  const [plugin, ...extra] = positionals;
  if (plugin === undefined) {
    return { kind: "error", message: "missing <plugin-path>" };
  }
  if (extra.length > 0) {
    return {
      kind: "error",
      message: `unexpected extra argument '${extra[0] ?? ""}'`,
    };
  }
  return {
    kind: "options",
    options: {
      plugin,
      tier: TIERS[tierName],
      model: values.get("--model"),
      judgeModel: values.get("--judge-model"),
      evalDir: values.get("--eval-dir"),
      reporting: {
        jsonFile: values.get("--json-file"),
        reportFile: values.get("--report"),
        outputDir: values.get("--output-dir"),
        publishReport: bools.has("--publish-report"),
        keepTemp: bools.has("--keep-temp"),
      },
      skipUnavailable: bools.has("--skip-unavailable"),
      dryRun: bools.has("--dry-run"),
    },
  };
};

/**
 * `--trust-plugin` is passed only for this repo's plugins: a direct child of
 * the `plugins/` directory this wrapper ships in. Anything else must be
 * trusted by hand.
 */
export const isRepoPlugin = (
  target: string,
  pluginsDir: string,
  realpath: (p: string) => string,
): boolean => dirname(realpath(target)) === realpath(pluginsDir);

/** What was run, recorded beside the results. Absolute scores differ between ablation modes. */
export interface RunSummary {
  readonly tier: string;
  readonly ablation: AblationMode;
  readonly scoringNote: string;
  readonly plugin: string;
  readonly groups: readonly GroupSummary[];
  readonly exit: ExitCode;
}

export interface GroupSummary {
  readonly cases: readonly string[];
  readonly grants: readonly string[];
  readonly command: readonly string[];
  readonly cliStatus: number | null;
  readonly exit: ExitCode;
  readonly reasons: readonly string[];
  readonly resultDir: string | undefined;
}

const scoringNote = (a: AblationMode): string =>
  a === "none"
    ? "ablation none: plugin arm only, nothing excluded from scoring; absolute scores differ from two-arm runs"
    : "CLI default arms: graders that cannot discriminate are excluded from the score in a two-arm run; absolute scores differ from ablation none";

const SUMMARY_FILE = "run-evals-summary.json";

/** Dependencies the entry point supplies; tests pass fakes. */
export interface Deps {
  readonly io: Io;
  /** The `plugins/` directory whose children get `--trust-plugin`. */
  readonly pluginsDir: string;
}

const fail = (io: Io, code: ExitCode, message: string): ExitCode => {
  io.err(`run-evals: ${message}\n`);
  return code;
};

/** Locate this run's result file: new entries under `dir` that hold an aggregate-result.json, newest last. */
const locateResult = (
  io: Io,
  dir: string,
  before: ReadonlySet<string>,
): { readonly dir: string; readonly text: string } | undefined =>
  candidateResultDirs(
    dir,
    io.listDir(dir).filter((e) => !before.has(e)),
  )
    .toReversed()
    .flatMap((d) => {
      const text = io.readFile(join(d, AGGREGATE_FILE));
      return text === undefined ? [] : [{ dir: d, text }];
    })[0];

const runGroup = async (
  io: Io,
  options: Options,
  target: string,
  trust: boolean,
  index: number,
  group: RunGroup,
  resultsBase: string,
): Promise<{ readonly summary: GroupSummary; readonly stop: boolean }> => {
  const outputDir =
    options.reporting.outputDir === undefined
      ? undefined
      : join(resolve(io.cwd, options.reporting.outputDir), `group-${String(index + 1)}`);
  const spec: RunSpec = {
    target,
    tier: options.tier,
    cases: group.cases,
    grants: group.grants,
    model: options.model,
    judgeModel: options.judgeModel,
    evalDir: options.evalDir,
    trustPlugin: trust,
    reporting: { ...options.reporting, outputDir },
  };
  const args = buildCliArgs(spec);
  const searchDir = outputDir ?? resultsBase;
  const before = new Set(io.listDir(searchDir));
  io.err(
    `run-evals: group ${String(index + 1)}: ${group.cases.join(", ")} (grants: ${group.grants.length === 0 ? "none" : group.grants.join(" ")})\n`,
  );
  const ran = await io.spawn("claude", args, {
    onStdout: io.out,
    onStderr: io.err,
  });
  if (ran.error !== undefined) {
    return {
      summary: {
        cases: group.cases,
        grants: group.grants,
        command: ["claude", ...args],
        cliStatus: null,
        exit: EXIT_DEPENDENCY,
        reasons: [`could not start claude: ${ran.error}`],
        resultDir: undefined,
      },
      stop: true,
    };
  }
  const located = locateResult(io, searchDir, before);
  const read = findingsFromText(located?.text, searchDir);
  const verdict: Judgement = judgeRun({
    status: ran.status,
    signal: ran.signal,
    signals: scanOutput(`${ran.stdout}\n${ran.stderr}`),
    findings: read.findings,
    resultProblem: read.problem,
    skipUnavailable: options.skipUnavailable,
  });
  verdict.reasons.forEach((r) => {
    io.err(`run-evals: group ${String(index + 1)}: ${r}\n`);
  });
  return {
    summary: {
      cases: group.cases,
      grants: group.grants,
      command: ["claude", ...args],
      cliStatus: ran.status,
      exit: verdict.code,
      reasons: verdict.reasons,
      resultDir: located?.dir,
    },
    stop: verdict.stop,
  };
};

/** Run the wrapper. Returns the process exit code; writes only through `deps.io`. */
export const main = async (
  argv: readonly string[],
  deps: Deps,
): Promise<ExitCode> => {
  const { io } = deps;
  const parsed = parseArgs(argv);
  if (parsed.kind === "help") {
    io.out(USAGE);
    return EXIT_OK;
  }
  if (parsed.kind === "error") {
    return fail(io, EXIT_USAGE, `${parsed.message}\n${USAGE}`);
  }
  const { options } = parsed;
  const target = resolve(io.cwd, options.plugin);
  const suite = readSuite(
    target,
    options.evalDir === undefined ? {} : { flag: options.evalDir },
  );
  const grants = readGrantsFile(join(suite.evalDir, "grants.yaml"));
  const plan = planGroups(
    suite,
    grants,
    options.tier.tag,
  );
  if (!plan.ok) return fail(io, EXIT_CONFIG, plan.reason);

  const trust = isRepoPlugin(target, deps.pluginsDir, io.realpath);
  const resultsBase = join(suite.evalDir, "results");

  if (options.dryRun) {
    plan.groups.forEach((g, i) => {
      const spec: RunSpec = {
        target,
        tier: options.tier,
        cases: g.cases,
        grants: g.grants,
        model: options.model,
        judgeModel: options.judgeModel,
        evalDir: options.evalDir,
        trustPlugin: trust,
        reporting: options.reporting,
      };
      io.out(
        `group ${String(i + 1)}: claude ${buildCliArgs(spec)
          .map((a) => (/[\s*()]/.test(a) ? JSON.stringify(a) : a))
          .join(" ")}\n`,
      );
    });
    return EXIT_OK;
  }

  const findings = await runPreflight(io, needsBash(plan.groups));
  findings.forEach((f) => {
    io.err(`run-evals: preflight ${f.level}: ${f.message}\n`);
  });
  const blocking = findings.filter((f) => f.level === "error");
  if (blocking.length > 0) {
    return blocking.reduce<ExitCode>((c, f) => worstExit(c, f.code), EXIT_OK);
  }

  const summaries = await plan.groups.reduce<
    Promise<{ readonly done: readonly GroupSummary[]; readonly stopped: boolean }>
  >(
    async (accP, group, i) => {
      const acc = await accP;
      if (acc.stopped) return acc;
      const r = await runGroup(io, options, target, trust, i, group, resultsBase);
      return { done: [...acc.done, r.summary], stopped: r.stop };
    },
    Promise.resolve({ done: [], stopped: false }),
  );
  const exit = summaries.done.reduce<ExitCode>(
    (c, g) => worstExit(c, g.exit),
    EXIT_OK,
  );
  const summary: RunSummary = {
    tier: options.tier.name,
    ablation: options.tier.ablation,
    scoringNote: scoringNote(options.tier.ablation),
    plugin: basename(target),
    groups: summaries.done,
    exit,
  };
  io.writeFile(
    join(options.reporting.outputDir === undefined ? resultsBase : resolve(io.cwd, options.reporting.outputDir), SUMMARY_FILE),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  io.err(
    `run-evals: tier ${options.tier.name}, ablation ${options.tier.ablation}: exit ${String(exit)}\n`,
  );
  return exit;
};

/** Entry point: the only code that touches `process`. */
const entry = async (): Promise<void> => {
  const code = await main(process.argv.slice(2), {
    io: nodeIo(process.env),
    pluginsDir: resolve(import.meta.dirname, "../../../.."),
  }).catch((e: unknown): ExitCode => {
    process.stderr.write(
      `run-evals: internal error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return EXIT_INTERNAL;
  });
  process.exitCode = code;
};

if (import.meta.main) void entry();
