/**
 * run-evals: a cost-tier wrapper around the plugin-eval CLI. Callers pick a
 * tier; the wrapper hides the flags, passes each case's recorded grants,
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
  EXIT_PARTIAL,
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
  plannedCaseProblem,
  rawResultFacts,
  type Judgement,
} from "./outcome.ts";
import { scanOutput } from "./output.ts";
import {
  needsBash,
  planGroups,
  planInvocations,
  type Invocation,
} from "./plan.ts";
import { runPreflight } from "./preflight.ts";
import {
  DEFAULT_TIER,
  TIERS,
  ceilingFor,
  QUICK_FLOOR_USD,
  QUICK_PER_CASE_USD,
  isTierName,
  type AblationMode,
  type Tier,
} from "./tiers.ts";

export const USAGE = `Usage: run-evals.ts [options] <plugin-path>

Run a plugin's eval cases at a cost tier. The CLI's --case takes one glob, so
the wrapper makes one CLI invocation per case, each under exactly that case's
grants (<eval-dir>/grants.yaml). Never passes --scaffold, --json or --report.

Options:
  --tier <name>        quick | standard | thorough (default: ${DEFAULT_TIER})
${Object.values(TIERS).map((t) => `                         ${t.name}: ${t.description}`).join("\n")}
  --max-cost-usd <usd> override the tier's cost ceiling (positive number).
                       The CLI has no default ceiling; the wrapper's tiers set
                       one: quick ${String(QUICK_PER_CASE_USD)} per case with a floor of ${String(QUICK_FLOOR_USD)}, standard
                       5 and thorough 15 (flat). The override is always a
                       total for the whole wrapper run, never per case. Each
                       invocation gets the remaining budget as its own
                       --max-cost-usd, the wrapper adds up each result's
                       costUsd (list price, judge calls included), and it
                       stops launching when nothing is left, listing the
                       unstarted cases (exit 7). A result with no readable
                       costUsd is charged its per-case share (ceiling divided
                       by cases), capped at what is left
  --model <id>         pin the model (default: pinned in the wrapper)
  --judge-model <id>   pin the judge model (default: pinned in the wrapper)
  --eval-dir <dir>     eval directory relative to the plugin
  --output-dir <dir>   base results directory (default: <eval-dir>/results).
                       Each wrapper run writes <dir>/run-<time>/<NN>-<case>
  --publish-report     publish the report (default: --no-publish)
  --keep-temp          keep run traces
  --skip-unavailable   exit 0 when plugin eval is in early access or down
  --dry-run            print the commands and exit; runs nothing
  -h, --help           show this help

After each invocation the wrapper checks that the result holds exactly the
planned case; a missing, extra or zero-case result exits 7 and names the case.

Exit codes:
  0   every case passed, results trustworthy
  1   below threshold, load failure, no cases, untrusted directory, invalid option
  2   wrapper usage error
  3   bad cases or grants file, or the CLI says a case cannot pass with its grants
  4   unmet requirement (Claude Code < 2.1.269, git < 2.31, sandbox backend,
      claude missing, or plugin eval unavailable)
  7   partial or untrustworthy run (cost ceiling, rejected credential, a run
      errored, paid graders skipped, a planned case missing from its result,
      or a result that could not be read)
  20  internal error
  130 interrupted
  143 terminated
`;

interface Options {
  readonly plugin: string;
  readonly tier: Tier;
  readonly model: string | undefined;
  readonly judgeModel: string | undefined;
  readonly maxCostUsd: number | undefined;
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
  "--max-cost-usd",
  "--model",
  "--judge-model",
  "--eval-dir",
  "--output-dir",
];
const BOOL_FLAGS: readonly string[] = [
  "--publish-report",
  "--keep-temp",
  "--skip-unavailable",
  "--dry-run",
];

/** A plain decimal greater than zero ("0.5", "2", ".5"); anything else (empty, "abc", "-1", "NaN", "1e3", "0x10", "0") is undefined. */
export const parseCost = (text: string): number | undefined => {
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

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
  const costText = values.get("--max-cost-usd");
  const maxCostUsd = costText === undefined ? undefined : parseCost(costText);
  if (costText !== undefined && maxCostUsd === undefined) {
    return {
      kind: "error",
      message: `--max-cost-usd must be a positive finite number of US dollars, got '${costText}'`,
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
      maxCostUsd,
      evalDir: values.get("--eval-dir"),
      reporting: {
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
  /** The cost ceiling for the whole run, and what the results charged against it. */
  readonly ceilingUsd: number;
  /** How the ceiling was derived (cases x per-case, the floor, flat, or the override). */
  readonly ceilingBasis: string;
  readonly spentUsd: number;
  readonly invocations: readonly InvocationSummary[];
  /** Cases never launched (budget spent, or an earlier invocation stopped the run). */
  readonly unstarted: readonly string[];
  readonly exit: ExitCode;
}

export interface InvocationSummary {
  readonly caseName: string;
  readonly grants: readonly string[];
  readonly command: readonly string[];
  readonly cliStatus: number | null;
  /** The budget this invocation was given as its `--max-cost-usd`. */
  readonly allottedUsd: number;
  /** What it was charged: the result's costUsd, or the per-case share of the ceiling when that was unreadable. */
  readonly chargedUsd: number;
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

/** Round to the 4 decimals a `--max-cost-usd` is given in; also keeps float drift out of the running total. */
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

/** A directory-name-safe form of a case name. */
const safeName = (name: string): string => name.replace(/[^\w.-]/g, "_");

const runStamp = (io: Io): string => io.now().toISOString().replace(/[:.]/g, "-");

const invocationSpec = (
  options: Options,
  target: string,
  trust: boolean,
  inv: Invocation,
  outputDir: string,
  budgetUsd: number,
): RunSpec => ({
  target,
  tier: options.tier,
  caseName: inv.caseName,
  grants: inv.grants,
  model: options.model,
  judgeModel: options.judgeModel,
  maxCostUsd: budgetUsd,
  evalDir: options.evalDir,
  trustPlugin: trust,
  reporting: { ...options.reporting, outputDir },
});

/** Where invocation `n` of `total` writes: `<runDir>/<NN>-<case>`. */
const invocationDir = (
  runDir: string,
  n: number,
  total: number,
  inv: Invocation,
): string =>
  join(
    runDir,
    `${String(n).padStart(Math.max(2, String(total).length), "0")}-${safeName(inv.caseName)}`,
  );

/** Locate this invocation's result: the (fresh) output directory itself, or one of its children. */
const locateResult = (
  io: Io,
  dir: string,
): { readonly dir: string; readonly text: string } | undefined =>
  candidateResultDirs(dir, io.listDir(dir))
    .toReversed()
    .flatMap((d) => {
      const text = io.readFile(join(d, AGGREGATE_FILE));
      return text === undefined ? [] : [{ dir: d, text }];
    })[0];

const runInvocation = async (
  io: Io,
  options: Options,
  target: string,
  trust: boolean,
  n: number,
  total: number,
  inv: Invocation,
  outputDir: string,
  budgetUsd: number,
  shareUsd: number,
): Promise<{ readonly summary: InvocationSummary; readonly stop: boolean }> => {
  const args = buildCliArgs(
    invocationSpec(options, target, trust, inv, outputDir, budgetUsd),
  );
  const label = `invocation ${String(n)}/${String(total)} (${inv.caseName})`;
  io.err(
    `run-evals: ${label}: grants: ${inv.grants.length === 0 ? "none" : inv.grants.join(" ")}; budget $${String(budgetUsd)}\n`,
  );
  const base = {
    caseName: inv.caseName,
    grants: inv.grants,
    command: ["claude", ...args],
    allottedUsd: budgetUsd,
  };
  const ran = await io.spawn("claude", args, {
    onStdout: io.out,
    onStderr: io.err,
  });
  if (ran.error !== undefined) {
    return {
      summary: {
        ...base,
        cliStatus: null,
        chargedUsd: Math.min(shareUsd, budgetUsd),
        exit: EXIT_DEPENDENCY,
        reasons: [`could not start claude: ${ran.error}`],
        resultDir: undefined,
      },
      stop: true,
    };
  }
  const located = locateResult(io, outputDir);
  const read = findingsFromText(located?.text, outputDir);
  const facts = rawResultFacts(located?.text);
  const verdict: Judgement = judgeRun({
    status: ran.status,
    signal: ran.signal,
    signals: scanOutput(`${ran.stdout}\n${ran.stderr}`),
    findings: read.findings,
    resultProblem: read.problem,
    skipUnavailable: options.skipUnavailable,
  });
  const mismatch = plannedCaseProblem(inv.caseName, facts.caseNames);
  const unreadableCharge = Math.min(shareUsd, budgetUsd);
  const noCost =
    facts.costUsd === undefined
      ? [`no readable costUsd in the result: charged the $${String(unreadableCharge)} per-case share of the ceiling`]
      : [];
  const reasons = [
    ...verdict.reasons,
    ...(mismatch === undefined ? [] : [mismatch]),
    ...noCost,
  ];
  reasons.forEach((r) => {
    io.err(`run-evals: ${label}: ${r}\n`);
  });
  return {
    summary: {
      ...base,
      cliStatus: ran.status,
      chargedUsd: facts.costUsd ?? unreadableCharge,
      exit:
        mismatch === undefined ? verdict.code : worstExit(verdict.code, EXIT_PARTIAL),
      reasons,
      resultDir: located?.dir,
    },
    stop: verdict.stop,
  };
};

interface Progress {
  readonly done: readonly InvocationSummary[];
  readonly spentUsd: number;
  readonly stopped: boolean;
  readonly outOfBudget: boolean;
}

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
  const base =
    options.reporting.outputDir === undefined
      ? join(suite.evalDir, "results")
      : resolve(io.cwd, options.reporting.outputDir);
  const runDir = join(base, `run-${runStamp(io)}`);
  const invocations = planInvocations(plan.groups);
  const total = invocations.length;
  const ceiling = ceilingFor(options.tier, total, options.maxCostUsd);
  const ceilingUsd = ceiling.usd;
  const shareUsd = round4(ceilingUsd / total);

  if (options.dryRun) {
    invocations.forEach((inv, i) => {
      const spec = invocationSpec(
        options,
        target,
        trust,
        inv,
        invocationDir(runDir, i + 1, total, inv),
        ceilingUsd,
      );
      io.out(
        `invocation ${String(i + 1)}/${String(total)}: claude ${buildCliArgs(spec)
          .map((a) => (/[\s*()]/.test(a) ? JSON.stringify(a) : a))
          .join(" ")}\n`,
      );
    });
    io.out(
      `ceiling: $${String(ceilingUsd)} for the whole run (${ceiling.basis}); a result with no costUsd is charged $${String(shareUsd)} (ceiling / ${String(total)} cases)\n`,
    );
    io.out(
      `note: each invocation shows the full ceiling; a real run gives later invocations only the budget left after earlier results\n`,
    );
    return EXIT_OK;
  }

  io.err(
    `run-evals: cost ceiling $${String(ceilingUsd)} for ${String(total)} case(s) (${ceiling.basis})\n`,
  );
  const findings = await runPreflight(io, needsBash(plan.groups));
  findings.forEach((f) => {
    io.err(`run-evals: preflight ${f.level}: ${f.message}\n`);
  });
  const blocking = findings.filter((f) => f.level === "error");
  if (blocking.length > 0) {
    return blocking.reduce<ExitCode>((c, f) => worstExit(c, f.code), EXIT_OK);
  }

  const progress = await invocations.reduce<Promise<Progress>>(
    async (accP, inv, i) => {
      const acc = await accP;
      if (acc.stopped || acc.outOfBudget) return acc;
      const remaining = round4(ceilingUsd - acc.spentUsd);
      if (remaining <= 0) return { ...acc, outOfBudget: true };
      const r = await runInvocation(
        io,
        options,
        target,
        trust,
        i + 1,
        total,
        inv,
        invocationDir(runDir, i + 1, total, inv),
        remaining,
        shareUsd,
      );
      return {
        done: [...acc.done, r.summary],
        spentUsd: round4(acc.spentUsd + r.summary.chargedUsd),
        stopped: r.stop,
        outOfBudget: false,
      };
    },
    Promise.resolve({ done: [], spentUsd: 0, stopped: false, outOfBudget: false }),
  );
  const unstarted = invocations
    .slice(progress.done.length)
    .map((inv) => inv.caseName);
  if (progress.outOfBudget) {
    io.err(
      `run-evals: cost ceiling $${String(ceilingUsd)} spent ($${String(progress.spentUsd)}); not run: ${unstarted.join(", ")}\n`,
    );
  }
  const exit = progress.done.reduce<ExitCode>(
    (c, g) => worstExit(c, g.exit),
    progress.outOfBudget ? EXIT_PARTIAL : EXIT_OK,
  );
  const summary: RunSummary = {
    tier: options.tier.name,
    ablation: options.tier.ablation,
    scoringNote: scoringNote(options.tier.ablation),
    plugin: basename(target),
    ceilingUsd,
    ceilingBasis: ceiling.basis,
    spentUsd: progress.spentUsd,
    invocations: progress.done,
    unstarted,
    exit,
  };
  io.writeFile(
    join(runDir, SUMMARY_FILE),
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
