/**
 * run-evals: a cost-tier wrapper around the plugin-eval CLI. Callers pick a
 * tier; the wrapper hides the flags, passes each case's recorded grants,
 * checks the preconditions, and turns the run into one named exit code.
 *
 * Usage: see USAGE below, or run with --help.
 */
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readGrantsFile, readSuite } from "../parser/index.ts";
import { buildCliArgs, type Reporting, type RunSpec } from "./command.ts";
import {
  EXIT_CONFIG,
  EXIT_DEPENDENCY,
  EXIT_FAILURE,
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_PARTIAL,
  EXIT_USAGE,
  worstExit,
  type ExitCode,
} from "./exit-codes.ts";
import { nodeIo, type Io, type SpawnResult } from "./io.ts";
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
import { BLOCK_END, BLOCK_START } from "./summary.ts";
import {
  needsBash,
  planGroups,
  planInvocations,
  selectChanged,
  type Invocation,
} from "./plan.ts";
import { runPreflight } from "./preflight.ts";
import { caseRow, redact, renderBlock, renderSummary, withBlock } from "./summary.ts";
import {
  DEFAULT_JUDGE_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TIER,
  TIERS,
  ceilingFor,
  QUICK_FLOOR_USD,
  QUICK_PER_CASE_USD,
  isTierName,
  type AblationMode,
  type Tier,
} from "./tiers.ts";
import { replyFiles, runCount, safeName } from "./traces.ts";

export const USAGE = `Usage: run-evals.ts [options] <plugin-path>

Run a plugin's eval cases at a cost tier. The CLI's --case takes one glob, so
the wrapper makes one CLI invocation per case, each under exactly that case's
grants (<eval-dir>/grants.yaml). Never passes --scaffold, --json or --report.
On macOS each invocation runs under caffeinate -i so the machine stays awake;
the recorded rerun command omits that prefix on purpose, so it pastes anywhere.

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
  --case <name-or-glob> run only the cases whose name matches (* and ?
                       are wildcards); the other cases are not planned, so the
                       ceiling, preflight and exit codes cover the subset.
                       One pattern, and no match is an error (exit 3)
  --changed[=<ref>]    run only the cases touched since the merge base with
                       <ref> (default: origin's HEAD, else origin/main),
                       counting committed, staged, unstaged and untracked
                       files under the plugin: a file under a case directory
                       selects that case; skills/<name>/ or agents/<name>.md
                       selects every case tagged <name> or whose tool_used
                       input_match accepts a call to it (bare or as
                       <plugin>:<name>); a change to a skill's or agent's
                       frontmatter (its description) also selects every
                       case tagged 'trigger', a body-only change does not;
                       scripts/** selects every case granted Bash (grants
                       or allowed_tools), or every case when a hook
                       references the script; grants.yaml, the manifest or
                       a hook selects every case; docs and README select
                       nothing. A renamed file counts under both paths. An
                       empty diff is exit 0 with a message. All or nothing:
                       any changed file that maps to no case is listed and
                       exits 1 before anything runs, even when other files
                       did map. With --pr, the block says it is a subset.
                       The file-to-case mapping is a heuristic and can miss
                       cases (hooks named by path, prose-only graders,
                       routing stolen from a sibling skill): run the full
                       tier before a release. Not combined with --case
  --changed-allow-empty
                       with --changed: run the mapped cases (exit 0 when
                       there are none) instead of exiting 1 over the
                       changed files that map to no case
  --output-dir <dir>   base results directory (default: <eval-dir>/results).
                       Each wrapper run writes <dir>/run-<time>/<NN>-<case>
  --publish-report     publish the report (default: --no-publish)
  --keep-temp          keep run traces and write replies/ next to the result:
                       each run's final reply and tool calls, redacted, at
                       <dir>/run-<time>/replies/<NN>-<case>/<case>/<arm>-<run>.md
  --skip-unavailable   exit 0 when plugin eval is in early access or down
  --dry-run            print the commands and exit; runs nothing
  --pr <n>             after the run, write the results summary into a marked
                       block (<!-- run-evals:start --> ... <!-- run-evals:end -->)
                       of PR <n>'s body with "gh pr edit", replacing the block
                       on a re-run. Off by default. Prints the exact block and
                       asks for confirmation; never edits in --dry-run
  --yes                with --pr: skip the confirmation (the block is still
                       printed first)
  -h, --help           show this help

At the end of a real run the wrapper prints a paste-ready Markdown summary
(per-case with, without and delta, tier, models, cost, the run command, and the
redacted, truncated failing reply of each failed grader).

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
  readonly only: string | undefined;
  /** `--changed`: the ref, "" for the default; undefined when off. */
  readonly changed: string | undefined;
  readonly changedAllowEmpty: boolean;
  readonly pr: string | undefined;
  readonly yes: boolean;
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
  "--case",
  "--pr",
];
const BOOL_FLAGS: readonly string[] = [
  "--publish-report",
  "--keep-temp",
  "--skip-unavailable",
  "--dry-run",
  "--yes",
  "--changed-allow-empty",
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
      if (a === "--changed" || a.startsWith("--changed=")) {
        values.set("--changed", a.slice("--changed=".length));
      } else if (VALUE_FLAGS.includes(a)) {
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
  const pr = values.get("--pr");
  if (pr !== undefined && !/^[1-9]\d*$/.test(pr)) {
    return { kind: "error", message: `--pr must be a PR number, got '${pr}'` };
  }
  if (pr !== undefined && bools.has("--dry-run")) {
    return { kind: "error", message: "--pr never runs with --dry-run (a dry run publishes nothing)" };
  }
  if (pr === undefined && bools.has("--yes")) {
    return { kind: "error", message: "--yes only applies with --pr" };
  }
  if (values.has("--changed") && values.has("--case")) {
    return { kind: "error", message: "--changed and --case are two selectors; pass one" };
  }
  if (!values.has("--changed") && bools.has("--changed-allow-empty")) {
    return { kind: "error", message: "--changed-allow-empty only applies with --changed" };
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
      only: values.get("--case"),
      changed: values.get("--changed"),
      changedAllowEmpty: bools.has("--changed-allow-empty"),
      pr,
      yes: bools.has("--yes"),
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
  /** The resolved `--changed` ref; null when the whole suite was planned. */
  readonly changedSince: string | null;
  /** "subset: N of M cases, --changed since <ref>" when `--changed` narrowed the run; null otherwise. */
  readonly subset: string | null;
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
  /** Where each run's final reply and tool calls went (`<arm>-<run>.md`); unset when no trace was readable. */
  readonly repliesDir?: string | undefined;
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

/** What a shell or caffeinate prints when the exec itself fails. */
const EXEC_FAILURE = /No such file or directory|Permission denied|command not found/;

/**
 * caffeinate "execs" the utility (man caffeinate, EXAMPLES), and on macOS it
 * does so in place: the utility runs in the pid Node spawned (verified: the
 * child's $$ equals the spawn's pid). So claude's exit status and a signal
 * death ({status: null, signal}) arrive exactly as a bare spawn sees them. The
 * wrapping artifact is caffeinate's own exec failure, 127 (not found) or 126
 * (not executable), with "<cmd>: <reason>" on stderr. claude itself can exit
 * 126/127 too, so the remap also needs that stderr shape and no result file;
 * anything else passes through to the usual exit-status judgement.
 */
export const unwrapExit = (
  r: SpawnResult,
  hasResult: boolean,
  home: string,
): SpawnResult => {
  const line = r.stderr.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
  if ((r.status !== 127 && r.status !== 126) || hasResult || !EXEC_FAILURE.test(line)) return r;
  // The reason lands in run-evals-summary.json: one line, home masked on a path boundary
  // (so /Users/x does not eat /Users/xavier), redacted before the cap so a cut secret is never
  // left half-visible. redact's long-run catch-all can also shorten a path segment; that is
  // the conservative direction for a diagnostic string.
  const bare = home.replace(/\/+$/, "");
  const masked =
    bare === ""
      ? line
      : line.replace(new RegExp(`${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=/|$)`, "g"), "~");
  const detail = redact(masked).slice(0, 200);
  return { ...r, status: null, error: `caffeinate exit ${String(r.status)}: ${detail}` };
};

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
): Promise<{
  readonly summary: InvocationSummary;
  readonly stop: boolean;
  /** The located aggregate-result.json text, for the printed summary only. */
  readonly resultText: string | undefined;
}> => {
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
  // macOS: keep the machine awake for the invocation. caffeinate execs claude
  // in place, so only its own 126/127 exec failure needs unwrapping.
  const [cmd, argv]: readonly [string, readonly string[]] =
    io.platform === "darwin" && io.findOnPath("caffeinate").length > 0
      ? ["caffeinate", ["-i", "--", "claude", ...args]]
      : ["claude", args];
  const raw = await io.spawn(cmd, argv, {
    onStdout: io.out,
    onStderr: io.err,
  });
  const located = locateResult(io, outputDir);
  const ran = cmd === "caffeinate" ? unwrapExit(raw, located !== undefined, homedir()) : raw;
  if (ran.error !== undefined) {
    const reason = `could not start claude: ${ran.error}`;
    io.err(`run-evals: ${label}: ${reason}\n`);
    return {
      summary: {
        ...base,
        cliStatus: null,
        chargedUsd: Math.min(shareUsd, budgetUsd),
        exit: EXIT_DEPENDENCY,
        reasons: [reason],
        resultDir: undefined,
      },
      stop: true,
      resultText: undefined,
    };
  }
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
    resultText: located?.text,
  };
};

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Write an invocation's replies files under `repliesDir` (only with
 * `--keep-temp`: otherwise the CLI has already deleted the traces). Nothing here
 * aborts the run: a failed write is one stderr line. Returns `repliesDir` when
 * every replies file was written and there was at least one; undefined otherwise.
 */
const persistReplies = (
  io: Io,
  label: string,
  repliesDir: string,
  resultText: string | undefined,
): string | undefined => {
  // A malformed trace must not cost the summary of a paid run.
  const replies = ((): ReturnType<typeof replyFiles> => {
    try {
      return replyFiles(repliesDir, resultText, io.readFile, io.home);
    } catch (e: unknown) {
      io.err(`run-evals: ${label}: could not read the run traces (${errorText(e)}); no replies written\n`);
      return [];
    }
  })();
  if (replies.length === 0 && runCount(resultText) > 0) {
    io.err(`run-evals: ${label}: no readable trace for any of its ${String(runCount(resultText))} run(s); no replies written\n`);
  }
  const written = replies.reduce<{ readonly n: number; readonly error: string | undefined }>(
    (acc, f) => {
      if (acc.error !== undefined) return acc;
      try {
        io.writeFile(f.path, f.text);
        return { ...acc, n: acc.n + 1 };
      } catch (e: unknown) {
        return { ...acc, error: `${f.path}: ${errorText(e)}` };
      }
    },
    { n: 0, error: undefined },
  );
  if (written.error !== undefined) {
    io.err(`run-evals: ${label}: could not write the replies files (${written.error}); continuing\n`);
  } else if (written.n > 0) {
    io.err(`run-evals: ${label}: ${String(written.n)} run replies in ${repliesDir}\n`);
  }
  return written.error === undefined && written.n > 0 ? repliesDir : undefined;
};

interface Progress {
  readonly done: readonly InvocationSummary[];
  readonly texts: readonly (string | undefined)[];
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
  const changed =
    options.changed === undefined
      ? undefined
      : await selectChanged(io, target, suite, grants, options.changed);
  if (changed !== undefined && !changed.ok) return fail(io, EXIT_USAGE, changed.reason);
  const tag = options.tier.tag;
  const inTier = (n: string): boolean =>
    tag === undefined ||
    suite.cases.some((c) => c.name.value === n && c.tags.value.includes(tag));
  const picked = changed === undefined ? undefined : changed.names.filter(inTier);
  if (changed !== undefined && picked !== undefined) {
    if (changed.paths.length === 0) {
      io.out(`run-evals: nothing changed since ${changed.ref} under ${target}; no case to run\n`);
      return EXIT_OK;
    }
    if (changed.unmapped.length > 0) {
      io.err(
        `run-evals: --changed: files that map to no case:\n${changed.unmapped.map((p) => `  ${p}`).join("\n")}\n`,
      );
    }
    if (changed.names.length === 0) {
      // A changed file that selects nothing is a wiring gap until someone says otherwise: never green by default.
      io.err(
        `run-evals: ${String(changed.paths.length)} files changed, none map to a case (since ${changed.ref} under ${target})\n`,
      );
      return options.changedAllowEmpty ? EXIT_OK : EXIT_FAILURE;
    }
    if (changed.unmapped.length > 0 && !options.changedAllowEmpty) {
      // All or nothing: a mapped case beside an unmapped file would run green over the gap.
      io.err(
        `run-evals: ${String(changed.unmapped.length)} of ${String(changed.paths.length)} changed files map to no case (since ${changed.ref} under ${target}); the mapped cases were ${changed.names.join(", ") || "none"}; pass --changed-allow-empty to run them anyway\n`,
      );
      return EXIT_FAILURE;
    }
    if (picked.length === 0) {
      io.out(
        `run-evals: the cases changed since ${changed.ref} (${changed.names.join(", ")}) are not tagged '${tag ?? ""}'; no case to run\n`,
      );
      return EXIT_OK;
    }
    io.err(`run-evals: --changed since ${changed.ref}: ${picked.join(", ")}\n`);
  }
  const plan = planGroups(suite, grants, tag, options.only, picked);
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
          .map(shellWord)
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
      const outDir = invocationDir(runDir, i + 1, total, inv);
      const r = await runInvocation(
        io,
        options,
        target,
        trust,
        i + 1,
        total,
        inv,
        outDir,
        remaining,
        shareUsd,
      );
      return {
        done: [...acc.done, r.summary],
        texts: [...acc.texts, r.resultText],
        spentUsd: round4(acc.spentUsd + r.summary.chargedUsd),
        stopped: r.stop,
        outOfBudget: false,
      };
    },
    Promise.resolve({ done: [], texts: [], spentUsd: 0, stopped: false, outOfBudget: false }),
  );
  // After the whole loop, so the summary below still reads each trace for its failing reply.
  const done = !options.reporting.keepTemp
    ? progress.done
    : progress.done.map((d, i) => {
        const repliesDir = persistReplies(
          io,
          `invocation ${String(i + 1)}/${String(total)} (${d.caseName})`,
          join(runDir, "replies", basename(invocationDir(runDir, i + 1, total, d))),
          progress.texts[i],
        );
        return repliesDir === undefined ? d : { ...d, repliesDir };
      });
  const unstarted = invocations
    .slice(progress.done.length)
    .map((inv) => inv.caseName);
  if (progress.outOfBudget) {
    io.err(
      `run-evals: cost ceiling $${String(ceilingUsd)} spent ($${String(progress.spentUsd)}); not run: ${unstarted.join(", ")}\n`,
    );
  }
  // The last case can overspend without any later case to notice, so check the total too.
  const exit = progress.done.reduce<ExitCode>(
    (c, g) => worstExit(c, g.exit),
    progress.outOfBudget || progress.spentUsd > ceilingUsd ? EXIT_PARTIAL : EXIT_OK,
  );
  // N is what finished, M what the same command would plan without --changed: the tier's cases.
  const subset =
    changed?.ok === true
      ? `subset: ${String(progress.done.length)} of ${String(suite.cases.filter((c) => inTier(c.name.value)).length)} ${options.tier.name} cases, --changed since ${changed.ref}`
      : null;
  const summary: RunSummary = {
    tier: options.tier.name,
    ablation: options.tier.ablation,
    scoringNote: scoringNote(options.tier.ablation),
    plugin: basename(target),
    ceilingUsd,
    ceilingBasis: ceiling.basis,
    spentUsd: progress.spentUsd,
    invocations: done,
    unstarted,
    exit,
    changedSince: changed?.ok === true ? changed.ref : null,
    subset,
  };
  io.writeFile(
    join(runDir, SUMMARY_FILE),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  io.err(
    `run-evals: tier ${options.tier.name}, ablation ${options.tier.ablation}: exit ${String(exit)}\n`,
  );
  const rendered = renderSummary({
    plugin: basename(target),
    tier: options.tier.name,
    model: options.model ?? DEFAULT_MODEL,
    judgeModel: options.judgeModel ?? DEFAULT_JUDGE_MODEL,
    spentUsd: progress.spentUsd,
    ceilingUsd,
    exit,
    command: `node plugins/eval-authoring/scripts/ts/run-evals/run-evals.ts ${argv.map(shellWord).join(" ")}`,
    unstarted,
    cases: done.map((d, i) => ({
      caseName: d.caseName,
      exit: d.exit,
      row: caseRow(d.caseName, progress.texts[i], io.readFile),
    })),
  });
  // A --changed run is a subset: say so under the heading, in the terminal and in the PR block alike.
  const markdown =
    subset === null ? rendered : rendered.replace("\n\n", `\n\n${subset}\n\n`);
  if (options.pr === undefined) {
    io.out(`\n${markdown}\n`);
    return exit;
  }
  const block = renderBlock(markdown);
  io.out(`\n${block}\n`);
  const published = await publishToPr(io, options.pr, block, options.yes, subset !== null);
  return published === undefined ? exit : worstExit(exit, published);
};

const shellWord = (a: string): string =>
  /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`;

/** The text between the run-evals markers of a PR body; undefined when there is no block. */
const priorBlock = (body: string): string | undefined => {
  const start = body.indexOf(BLOCK_START);
  const end = body.indexOf(BLOCK_END, start);
  return start >= 0 && end >= 0 ? body.slice(start, end) : undefined;
};

/**
 * The publish step of --pr: show the block, get a yes (or --yes), then edit
 * the PR body. Returns an exit code only when something went wrong.
 */
const publishToPr = async (
  io: Io,
  pr: string,
  block: string,
  yes: boolean,
  subset: boolean,
): Promise<ExitCode | undefined> => {
  const view = await io.spawn("gh", ["pr", "view", pr, "--json", "body", "-q", ".body"]);
  const prior = view.status === 0 ? priorBlock(view.stdout) : undefined;
  if (subset && prior !== undefined && !prior.includes("\nsubset: ")) {
    io.err(
      `run-evals: warning: PR #${pr}'s run-evals block holds a full run; this --changed subset replaces it\n`,
    );
  }
  if (view.error !== undefined || view.status !== 0) {
    io.err(`run-evals: could not read PR #${pr} (gh pr view failed); body not edited\n`);
    return EXIT_DEPENDENCY;
  }
  if (!yes && !(await io.confirm(`Write the block above into the body of PR #${pr}? [y/N] `))) {
    io.err(`run-evals: PR #${pr} not edited\n`);
    return undefined;
  }
  const edit = await io.spawn("gh", [
    "pr",
    "edit",
    pr,
    "--body",
    withBlock(view.stdout.replace(/\n$/, ""), block),
  ]);
  if (edit.error !== undefined || edit.status !== 0) {
    io.err(`run-evals: gh pr edit failed for PR #${pr}; body not edited\n`);
    return EXIT_DEPENDENCY;
  }
  io.err(`run-evals: PR #${pr} body updated\n`);
  return undefined;
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
